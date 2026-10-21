export const chatSchemaSource = `import {pgTable,text,jsonb,integer,timestamp,index,primaryKey} from "drizzle-orm/pg-core";
import {authUser} from "./auth-schema.js";
export const aiChat=pgTable("ai_chat",{id:text("id").primaryKey(),ownerId:text("owner_id").notNull().references(()=>authUser.id,{onDelete:"cascade"}),title:text("title").notNull().default("New conversation"),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),lease:text("lease"),leaseUntil:timestamp("lease_until",{withTimezone:true})},t=>[index("ai_chat_owner_updated_idx").on(t.ownerId,t.updatedAt)]);
export const aiChatMessage=pgTable("ai_chat_message",{chatId:text("chat_id").notNull().references(()=>aiChat.id,{onDelete:"cascade"}),id:text("id").notNull(),position:integer("position").notNull(),message:jsonb("message").notNull()},t=>[primaryKey({columns:[t.chatId,t.id]}),index("ai_chat_message_order_idx").on(t.chatId,t.position)]);
export const aiChatAction=pgTable("ai_chat_action",{chatId:text("chat_id").notNull().references(()=>aiChat.id,{onDelete:"cascade"}),callId:text("call_id").notNull(),status:text("status").notNull(),result:jsonb("result")},t=>[primaryKey({columns:[t.chatId,t.callId]})]);
`;

export const chatHistorySource = `import {and,eq,desc,asc,sql} from "drizzle-orm";
import type {UIMessage} from "ai";
import {createDrizzleDatabase} from "../database/drizzle-database.js";
import {aiChat,aiChatMessage,aiChatAction} from "../database/schema/chat-schema.js";
import {ToolFailure} from "./registry.js";
function canonical(value:unknown):string{if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";if(value&&typeof value==="object")return "{"+Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+":"+canonical(item)).join(",")+"}";return JSON.stringify(value)??"null";}
/** Accept only a new user turn or decisions about server-stored pending approvals. */
export function reconcileHistory(stored:UIMessage[],incoming:UIMessage[]):UIMessage[]{
 if(incoming.length===stored.length+1&&incoming.at(-1)?.role==="user"){
  if(canonical(incoming.slice(0,-1))!==canonical(stored))throw new ToolFailure(409,"Conversation changed. Reload it before sending.");
  const message=incoming.at(-1)!;
  if(!message.id||stored.some(item=>item.id===message.id)||message.parts.some(part=>part.type!=="text")||!message.parts.some(part=>part.type==="text"&&part.text.trim()))throw new ToolFailure(400,"Send a text message.");
  return [...stored,{id:message.id,role:"user",parts:message.parts}];
 }
 if(!stored.length||incoming.length!==stored.length)throw new ToolFailure(409,"Conversation changed. Reload it before sending.");
 const next=structuredClone(stored);let changed=false;
 for(let i=0;i<next.length;i++){
  const current=next[i],provided=incoming[i];
  if(current.id!==provided.id||current.role!==provided.role||current.parts.length!==provided.parts.length)throw new ToolFailure(400,"Invalid conversation update.");
  for(let j=0;j<current.parts.length;j++){
   const part=current.parts[j],candidate=provided.parts[j];
   if("state" in part&&part.state==="approval-requested"&&"approval" in part&&part.approval&&"state" in candidate&&candidate.state==="approval-responded"&&"approval" in candidate&&candidate.approval&&candidate.approval.id===part.approval.id&&typeof candidate.approval.approved==="boolean"){
    const expected={...part,state:"approval-responded",approval:{...part.approval,approved:candidate.approval.approved,...(candidate.approval.reason?{reason:candidate.approval.reason}:{})}};
    if(canonical(expected)!==canonical(candidate))throw new ToolFailure(400,"Invalid approval update.");
    current.parts[j]=expected as UIMessage["parts"][number];changed=true;
   }else if(canonical(part)!==canonical(candidate))throw new ToolFailure(400,"Invalid conversation update.");
  }
 }
 if(!changed)throw new ToolFailure(409,"This turn was already processed.");
 return next;
}
export function createChatStore(url:string){
 const db=createDrizzleDatabase(url);const owned=(id:string,owner:string)=>and(eq(aiChat.id,id),eq(aiChat.ownerId,owner));
 const metadata={id:aiChat.id,title:aiChat.title,updatedAt:aiChat.updatedAt};
 return {
  async action(id:string,owner:string,token:string,callId:string,execute:()=>Promise<unknown>){
   const [chat]=await db.select({id:aiChat.id}).from(aiChat).where(and(owned(id,owner),eq(aiChat.lease,token)));
   if(!chat)throw new ToolFailure(409,"This conversation is no longer active. Reload it.");
   const reserved=await db.insert(aiChatAction).values({chatId:id,callId,status:"started"}).onConflictDoNothing().returning({callId:aiChatAction.callId});
   const condition=and(eq(aiChatAction.chatId,id),eq(aiChatAction.callId,callId));
   if(!reserved.length){const [previous]=await db.select().from(aiChatAction).where(condition);if(previous?.status==="done")return previous.result;throw new ToolFailure(409,"This action was already attempted. Check your records before requesting a new action.");}
   try{const result=await execute();await db.update(aiChatAction).set({status:"done",result:result??null}).where(condition);return result;}catch(error){await db.update(aiChatAction).set({status:"failed"}).where(condition);throw error;}
  },
  async list(owner:string,offset=0){return db.select(metadata).from(aiChat).where(eq(aiChat.ownerId,owner)).orderBy(desc(aiChat.updatedAt),desc(aiChat.id)).limit(51).offset(offset);},
  async create(owner:string){const id=crypto.randomUUID();return (await db.insert(aiChat).values({id,ownerId:owner}).returning(metadata))[0];},
  async load(id:string,owner:string){const [chat]=await db.select(metadata).from(aiChat).where(owned(id,owner));if(!chat)throw new ToolFailure(404,"Conversation not found.");const rows=await db.select({message:aiChatMessage.message}).from(aiChatMessage).where(eq(aiChatMessage.chatId,id)).orderBy(asc(aiChatMessage.position));return {...chat,messages:rows.map(row=>row.message as UIMessage)};},
  async remove(id:string,owner:string){const rows=await db.delete(aiChat).where(and(owned(id,owner),sql\`(\${aiChat.leaseUntil} IS NULL OR \${aiChat.leaseUntil}<now())\`)).returning({id:aiChat.id});if(!rows.length)throw new ToolFailure(409,"Conversation not found or still responding.");},
  async acquire(id:string,owner:string){const token=crypto.randomUUID();const rows=await db.update(aiChat).set({lease:token,leaseUntil:sql\`now()+interval '5 minutes'\`}).where(and(owned(id,owner),sql\`(\${aiChat.leaseUntil} IS NULL OR \${aiChat.leaseUntil}<now())\`)).returning({id:aiChat.id});if(!rows.length)throw new ToolFailure(409,"Conversation unavailable or still responding. Reload before retrying.");return token;},
  async save(id:string,owner:string,token:string,messages:UIMessage[],release=false){
   if(messages.length>100||JSON.stringify(messages).length>2000000)throw new ToolFailure(400,"Conversation is full. Start a new chat.");
   // The owner and current lease are checked in the insert itself, including after a disconnect.
   if(messages.length){const rows=messages.map((message,position)=>sql\`(\${id},\${message.id},\${position},\${JSON.stringify(message)}::jsonb)\`);await db.execute(sql\`INSERT INTO ai_chat_message(chat_id,id,position,message) SELECT v.chat_id,v.id,v.position::integer,v.message FROM (VALUES \${sql.join(rows,sql\`,\`)}) AS v(chat_id,id,position,message) WHERE EXISTS(SELECT 1 FROM ai_chat WHERE id=\${id} AND owner_id=\${owner} AND lease=\${token}) ON CONFLICT(chat_id,id) DO UPDATE SET position=excluded.position,message=excluded.message\`);}
   const first=messages.find(message=>message.role==="user")?.parts.find(part=>part.type==="text");
   await db.update(aiChat).set({title:first?.type==="text"?first.text.slice(0,80):"New conversation",updatedAt:new Date(),...(release?{lease:null,leaseUntil:null}:{})}).where(and(owned(id,owner),eq(aiChat.lease,token)));
  },
  async release(id:string,owner:string,token:string){await db.update(aiChat).set({lease:null,leaseUntil:null}).where(and(owned(id,owner),eq(aiChat.lease,token)));}
 };
}
`;
