import type { GeneratedFile } from "../plugins/contracts.js";
import type { FrontendRenderContext } from "../plugins/frontend-contracts.js";
import type { TransportInput } from "../project/types.js";
function schema(input: TransportInput): string {
  const field = input.definition;
  let value =
    field.type === "number"
      ? `z.number().finite()${field.format === "integer" ? ".int()" : ""}`
      : field.type === "boolean"
        ? "z.boolean()"
        : field.type === "json"
          ? 'JsonValueSchema.refine(value=>value!==null,{message:"Expected a non-null JSON value."})'
          : field.type === "enum"
            ? `z.enum(${JSON.stringify(field.value.enumValues)} as const)`
            : field.type === "uuid"
              ? "z.string().uuid()"
              : field.type === "date"
                ? "z.string().datetime({offset:true})"
                : `z.string()${field.minLength === undefined ? "" : `.min(${field.minLength})`}${field.maxLength === undefined ? "" : `.max(${field.maxLength})`}`;
  if (input.nullable) value += ".nullable()";
  if (input.array) value = `z.array(${value}).min(1)`;
  if (input.optional) value += ".optional()";
  return `z.preprocess(value=>coerceFormValue(value,${JSON.stringify({ type: field.type, optional: input.optional, array: input.array })}),${value})`;
}
/** Forms consume resolved HTTP inputs, rather than inventing entity mutations. */
export function generateFrontendForms(context: FrontendRenderContext): readonly GeneratedFile[] {
  const names = context.api.operationNames;
  const automatic = new Set(
    Object.values(context.api.features).flatMap((feature) =>
      [feature.list, feature.create, feature.update, feature.delete].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  );
  const operations = context.api.endpoints.filter((operation) => automatic.has(operation.id));
  const bodies = Object.fromEntries(
    operations.map((operation) => [names[operation.id], operation.body.fields]),
  );
  const parts = operations.flatMap((operation) => {
    const name = names[operation.id];
    const body = Object.entries(operation.body.fields)
      .map(([key, input]) => `${JSON.stringify(key)}:${schema(input)}`)
      .join(",");
    const result: string[] = [];
    if (operation.body.kind !== "none")
      result.push(
        `export const ${name}FormSchema=z.object({${body}}).strict()${operation.action === "update" ? '.refine(value=>Object.values(value).some(item=>item!==undefined),{message:"At least one field must be updated."})' : ""};`,
      );
    if (operation.method === "GET")
      return [
        `export const ${name}QueryFormSchema=z.object({${operation.queryParams.map((parameter) => `${JSON.stringify(parameter.name)}:${schema(parameter.input)}`).join(",")}}).strict();`,
        `export function ${name}QueryFormInput(values:Record<string,unknown>):${name}Input {return {query:${name}QueryFormSchema.parse(values)};}`,
      ];
    result.push(
      `export function ${name}FormInput(values:Record<string,unknown>${operation.recordIdParameter ? ",id:string" : ""}):${name}Input {return {${operation.recordIdParameter ? `path:{${JSON.stringify(operation.recordIdParameter)}:id},` : ""}${operation.body.kind !== "none" ? `body:${name}FormSchema.parse(values)` : ""}};}`,
    );
    return result;
  });
  return [
    {
      path: `${context.framework.codeRoot}/lib/api/forms.ts`,
      content: `import {z} from "zod";
${operations.map((operation) => `import type {${names[operation.id]}Input} from "./types";`).join("\n")}
type JsonValue=string|number|boolean|null|JsonValue[]|{[key:string]:JsonValue};
const JsonValueSchema:z.ZodType<JsonValue>=z.lazy(()=>z.union([z.string(),z.number().finite(),z.boolean(),z.null(),z.array(JsonValueSchema),z.record(JsonValueSchema)]));
interface FormField {type:string;optional:boolean;array?:boolean;}
export function coerceFormValue(value:unknown,field:FormField):unknown {
 if(value===undefined || value===null)return value;
 if(value==="" && field.optional)return undefined;
 if(field.array && typeof value==="string"){try{const items:unknown=JSON.parse(value);return Array.isArray(items)?items.map(item=>field.type==="json"?item:coerceFormValue(item,{...field,array:false})):Symbol("invalid-array");}catch{return Symbol("invalid-array");}}
 if(field.type==="number")return typeof value==="number"?value:typeof value==="string"&&value.trim()!==""?Number(value):Number.NaN;
 if(field.type==="boolean")return value==="true"?true:value==="false"?false:value;
 if(field.type==="date" && typeof value==="string"){const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():value;}
 if(field.type==="json" && typeof value==="string"){try{return JSON.parse(value) as unknown;}catch{return Symbol("invalid-json");}}
 return value;
}
type FormOperation=${operations.map((operation) => JSON.stringify(names[operation.id])).join("|") || "never"};
interface BodyField {readonly nullable:boolean;readonly definition:{readonly type:string;readonly defaultValue:{readonly kind:"absent"|"clock"}|{readonly kind:"literal";readonly value:unknown};readonly [name:string]:unknown};readonly [name:string]:unknown;}
const bodyFields:Readonly<Record<string,Readonly<Record<string,BodyField>>>>=${JSON.stringify(bodies)};
export function formDefaults(operation:FormOperation,record?:object):Record<string,unknown> {
 const values:Record<string,unknown>={};const row=record as Record<string,unknown>|undefined;
 if(!Object.hasOwn(bodyFields,operation))throw new Error("This operation has no generated form.");
 for(const [name,input]of Object.entries(bodyFields[operation])){
  const field=input.definition;let value=row?row[name]:field.defaultValue.kind==="literal"?field.defaultValue.value:input.nullable?null:field.type==="boolean"?false:undefined;
  if(field.type==="json" && value!==undefined && value!==null)value=JSON.stringify(value);
  if(field.type==="date" && typeof value==="string"){const date=new Date(value);if(Number.isFinite(date.getTime())){const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);value=local.toISOString().slice(0,19);}}
  values[name]=value;
 }return values;
}
${parts.join("\n")}
`,
    },
  ];
}
