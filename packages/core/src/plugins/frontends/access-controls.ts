/** Shared, explicit access choices for both platform and organization administration. */
export const accessControls = String.raw`"use client";
import {useId,useState} from "react";

export function accessTitle(value:string){return value==='iam'?'Platform administration':value==='org'?'Organization administration':value.replaceAll('-',' ').replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());}
export function permissionLabel(value:string){
 const labels:Record<string,string>={'iam:roles:manage':'Manage roles & permissions','iam:users:manage-roles':'Assign user roles','org:roles:manage':'Manage organization roles','org:members:manage':'Manage members & invitations','org:manage':'Manage organization settings'};
 if(labels[value])return labels[value];
 if(value==='*')return 'Full access';
 const [subject,...parts]=value.split(':');const action=parts.pop();
 if(subject==='storage')return (action==='read'?'Browse & download ':'Upload to ')+accessTitle(parts.join(' '));
 return (action==='read'?'View ':action==='write'?'Create & update ':action==='delete'?'Delete ':accessTitle(action??'')+' ')+accessTitle(subject);
}
export function permissionDescription(value:string){
 if(value==='iam:roles:manage')return 'Create platform roles and decide what each role can do.';
 if(value==='iam:users:manage-roles')return 'Assign platform roles to user accounts.';
 if(value==='org:roles:manage')return 'Create roles and edit permissions within this organization.';
 if(value==='org:members:manage')return 'Invite people, change their roles, and remove members.';
 if(value==='org:manage')return 'Update the settings of this organization.';
 if(value.startsWith('org:'))return 'Allow this administrative action within this organization.';
 if(value.startsWith('storage:'))return value.endsWith(':read')?'List, preview, and download files.':'Upload new files to this storage instance.';
 return value.endsWith(':read')?'Browse and read these records.':value.endsWith(':write')?'Create records and make changes.':'Allow this application capability.';
}
export function PermissionPicker({permissions,value,onChange,disabled=false,locked=[],fullAccess=false,scope}:{permissions:string[];value:string[];onChange:(value:string[])=>void;disabled?:boolean;locked?:string[];fullAccess?:boolean;scope:'global'|'organization'}){
 const [search,setSearch]=useState('');const id=useId();const query=search.trim().toLowerCase();
 const visible=permissions.filter(permission=>(permission+' '+permissionLabel(permission)).toLowerCase().includes(query));
 const groups=[...new Set(visible.map(permission=>permission.split(':')[0]))];
 return <section className="ng-access-permissions" aria-labelledby={id}><div className="ng-iam-permissions-heading"><div><h3 id={id}>Permissions</h3><p>{scope==='organization'?'These permissions apply only within this organization.':'These permissions apply across the platform.'}</p></div><span className="ng-iam-tag">{fullAccess?permissions.length:permissions.filter(permission=>value.includes(permission)).length} of {permissions.length} selected</span></div>
 <label className="ng-field"><span className="ng-sr-only">Find a permission</span><input className="ng-input" type="search" placeholder="Find a permission…" value={search} onChange={event=>setSearch(event.target.value)}/></label>
 <div className="ng-iam-permission-groups">{groups.map(group=><fieldset className="ng-iam-permission-group" key={group}><legend>{accessTitle(group)}</legend>{visible.filter(permission=>permission.split(':')[0]===group).map(permission=>{const checked=fullAccess||value.includes(permission);return <label className={'ng-iam-permission'+(checked?' ng-iam-permission--selected':'')} key={permission}><input type="checkbox" disabled={disabled||fullAccess||locked.includes(permission)} checked={checked} onChange={event=>onChange(event.target.checked?[...value,permission]:value.filter(item=>item!==permission))}/><span><strong>{permissionLabel(permission)}</strong><span>{permissionDescription(permission)}</span><code>{permission}</code></span></label>;})}</fieldset>)}</div>{visible.length===0&&<p className="ng-access-help" role="status">No permissions match your search.</p>}</section>;
}
export interface RoleOption{id:string;name:string;description?:string|null;}
export function RoleChoices({roles,value,onChange,multiple,disabled=false}:{roles:RoleOption[];value:string[];onChange:(value:string[])=>void;multiple:boolean;disabled?:boolean}){
 const id=useId();return <fieldset className="ng-access-role-choices"><legend>Assigned roles</legend><p className="ng-access-help">{multiple?'Select one or more roles. Their permissions are combined.':'Select the role this person should have.'}</p><div className="ng-access-role-list">{roles.map(role=><label className={'ng-iam-permission'+(value.includes(role.id)?' ng-iam-permission--selected':'')} key={role.id}><input type={multiple?'checkbox':'radio'} name={id} value={role.id} checked={value.includes(role.id)} disabled={disabled} onChange={event=>onChange(multiple?(event.target.checked?[...value,role.id]:value.filter(item=>item!==role.id)):[role.id])}/><span><strong>{role.name}</strong>{role.description&&<span>{role.description}</span>}</span></label>)}</div>{roles.length===0&&<p role="status">No roles are available.</p>}<small>{value.length} selected</small></fieldset>;
}
`;
