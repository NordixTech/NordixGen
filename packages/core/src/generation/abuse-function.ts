/** Invoker rights only. One database statement retains ordered locks and all-or-nothing counters. */
export const abuseFunctionSql = String.raw`CREATE OR REPLACE FUNCTION public.nordix_consume_limits(rules jsonb)
RETURNS TABLE ("retryAfter" integer,"nextDelay" integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE r jsonb; s record; states jsonb:='[]'; item jsonb; t bigint; active boolean;
 count_now integer; delay_ms double precision; wait_ms double precision; maximum_wait double precision:=0;
 next_delay double precision:=0; initial_delay double precision; cap double precision; multiplier double precision;
BEGIN
 IF rules IS NULL OR jsonb_typeof(rules) <> 'array' OR jsonb_array_length(rules)>10 THEN RAISE EXCEPTION 'Invalid limit rules'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(rules)) <> (SELECT count(DISTINCT value->>'key') FROM jsonb_array_elements(rules)) THEN RAISE EXCEPTION 'Duplicate limit key'; END IF;
 BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  FOR r IN SELECT value FROM jsonb_array_elements(rules) ORDER BY value->>'key' COLLATE "C" LOOP
   IF coalesce(r->>'key','')='' OR coalesce((r->>'max')::integer,0)<1 OR coalesce((r->>'window')::integer,0)<1 THEN RAISE EXCEPTION 'Invalid limit rule'; END IF;
   INSERT INTO public.auth_abuse_limit(key,count,window_start,last_request) VALUES(r->>'key',0,0,0) ON CONFLICT(key) DO NOTHING;
   SELECT count,window_start,last_request INTO STRICT s FROM public.auth_abuse_limit WHERE key=r->>'key' FOR UPDATE;
   states:=states||jsonb_build_array(jsonb_build_object('rule',r,'count',s.count,'windowStart',s.window_start,'lastRequest',s.last_request));
  END LOOP;
  t:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  FOR item IN SELECT value FROM jsonb_array_elements(states) LOOP
   r:=item->'rule';active:=t-(item->>'windowStart')::bigint<(r->>'window')::bigint*1000;
   count_now:=CASE WHEN active THEN (item->>'count')::integer ELSE 0 END;
   initial_delay:=coalesce((r->>'initialDelay')::double precision,0);cap:=coalesce((r->>'maxDelay')::double precision,0);multiplier:=coalesce((r->>'multiplier')::double precision,1);
   IF initial_delay<0 OR cap<0 OR multiplier<1 THEN RAISE EXCEPTION 'Invalid cooldown'; END IF;
   delay_ms:=0;
   IF count_now>0 AND initial_delay>0 AND cap>0 THEN
    IF multiplier=1 THEN delay_ms:=least(cap,initial_delay)*1000;
    ELSIF initial_delay>=cap OR count_now-1>=ln(cap/initial_delay)/ln(multiplier) THEN delay_ms:=cap*1000;
    ELSE delay_ms:=least(cap,initial_delay*power(multiplier,count_now-1))*1000;END IF;
   END IF;
   wait_ms:=CASE WHEN count_now>=(r->>'max')::integer THEN (item->>'windowStart')::bigint+(r->>'window')::bigint*1000-t
    WHEN active AND count_now>0 THEN (item->>'lastRequest')::bigint+delay_ms-t ELSE 0 END;
   maximum_wait:=greatest(maximum_wait,wait_ms);
   IF initial_delay>0 AND cap>0 THEN
    IF multiplier=1 THEN next_delay:=greatest(next_delay,least(cap,initial_delay));
    ELSIF initial_delay>=cap OR count_now>=ln(cap/initial_delay)/ln(multiplier) THEN next_delay:=greatest(next_delay,cap);
    ELSE next_delay:=greatest(next_delay,least(cap,initial_delay*power(multiplier,count_now)));END IF;
   END IF;
  END LOOP;
  IF maximum_wait>0 THEN RAISE SQLSTATE 'P0117'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(states) LOOP
   r:=item->'rule';active:=t-(item->>'windowStart')::bigint<(r->>'window')::bigint*1000;
   count_now:=CASE WHEN active THEN (item->>'count')::integer ELSE 0 END;
   UPDATE public.auth_abuse_limit SET count=count_now+1,window_start=CASE WHEN active AND count_now>0 THEN (item->>'windowStart')::bigint ELSE t END,last_request=t WHERE key=r->>'key';
  END LOOP;
  RETURN QUERY SELECT 0,ceil(next_delay)::integer;
 EXCEPTION WHEN SQLSTATE 'P0117' THEN
  -- Roll back every insert/update in this block if any key is blocked.
  RETURN QUERY SELECT ceil(maximum_wait/1000)::integer,0;
 END;
END $fn$;`;
