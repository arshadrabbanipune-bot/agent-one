import crypto from 'node:crypto';
import {env,setSession,session} from './_auth.js';
import {ensureUserAccess,supabaseData} from './_supabase.js';

const tokenKey=()=>{
  const secret=env('TOKEN_ENCRYPTION_KEY');
  if(!secret)throw new Error('TOKEN_ENCRYPTION_KEY is missing.');
  return crypto.createHash('sha256').update(secret).digest();
};
export const encryptNotionToken=value=>{
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',tokenKey(),iv);
  const ciphertext=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
};
export const decryptNotionToken=value=>{
  const [version,iv,tag,ciphertext]=String(value||'').split('.');
  if(version!=='v1'||!iv||!tag||!ciphertext)throw new Error('Stored Notion connection is invalid.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',tokenKey(),Buffer.from(iv,'base64url'));
  decipher.setAuthTag(Buffer.from(tag,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64url')),decipher.final()]).toString('utf8');
};
const q=value=>encodeURIComponent(String(value));
const first=value=>Array.isArray(value)?value[0]||null:value||null;

async function data(token,path,options={}){
  const result=await supabaseData(`/rest/v1/${path}`,{...options,token});
  if(!result.ok)throw new Error(result.json?.message||`Supabase request failed (${result.status}).`);
  return result.json;
}

export async function getSessionWithNotion(req,res){
  const initial=session(req);
  if(!initial?.user)return null;
  if(initial.notion?.token)return initial;
  const access=await ensureUserAccess(req,res);
  const current=access.session||initial;
  if(!access.token)return current;
  try{
    const rows=await data(access.token,`notion_connections?select=workspace_id,workspace_name,access_token_ciphertext,connection_status&user_id=eq.${q(current.user.id)}&limit=1`);
    const row=first(rows);
    if(!row||row.connection_status==='disconnected')return current;
    const notion={token:decryptNotionToken(row.access_token_ciphertext),workspace:row.workspace_name||'Notion workspace',workspaceId:row.workspace_id||''};
    setSession(res,current.user,notion,current.auth);
    return {...current,notion};
  }catch{return current;}
}

export async function saveNotionConnection(req,res,notion){
  const access=await ensureUserAccess(req,res);
  if(!access.token||!access.session?.user||!notion?.token)return false;
  const now=new Date().toISOString();
  await data(access.token,'notion_connections?on_conflict=user_id',{
    method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{
      user_id:access.session.user.id,
      workspace_id:notion.workspaceId||'unknown',
      workspace_name:notion.workspace||'Notion workspace',
      access_token_ciphertext:encryptNotionToken(notion.token),
      connection_status:'connected',
      last_successful_check_at:now,
      updated_at:now
    }
  });
  return true;
}

export async function disconnectStoredNotion(req,res){
  const access=await ensureUserAccess(req,res);
  if(!access.token||!access.session?.user)return false;
  await data(access.token,`notion_connections?user_id=eq.${q(access.session.user.id)}`,{method:'PATCH',prefer:'return=minimal',body:{connection_status:'disconnected',access_token_ciphertext:'',updated_at:new Date().toISOString()}});
  return true;
}

const settingsFromRow=row=>row?{
  dailyEntrySourceId:row.daily_entry_source_id||'',dailyEntrySourceType:row.daily_entry_source_type||'',dailyEntryDateProperty:row.daily_entry_date_property||'',dailyEntryTitleProperty:row.daily_entry_title_property||'',
  mapObjectId:row.map_object_id||'',mapObjectType:row.map_object_type||'',exerciseSectionBlockId:row.exercise_section_block_id||'',timezone:row.timezone||'Asia/Kolkata',
  confirmationPreference:row.confirmation_preference||'risk_based',voiceResponsePreference:row.voice_response_preference!==false,defaultInsertionBehavior:row.default_insertion_behavior||'match_existing'
}:null;

export async function getAssistantSettings(req,res){
  const access=await ensureUserAccess(req,res);
  if(!access.token||!access.session?.user)return {settings:null,access};
  const rows=await data(access.token,`notion_assistant_settings?select=*&user_id=eq.${q(access.session.user.id)}&limit=1`);
  return {settings:settingsFromRow(first(rows)),access};
}

export async function saveAssistantSettings(req,res,value){
  const access=await ensureUserAccess(req,res);
  if(!access.token||!access.session?.user)throw new Error('Please sign in again before saving assistant settings.');
  await data(access.token,'notion_assistant_settings?on_conflict=user_id',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{
    user_id:access.session.user.id,daily_entry_source_id:value.dailyEntrySourceId||null,daily_entry_source_type:value.dailyEntrySourceType||null,
    daily_entry_date_property:value.dailyEntryDateProperty||null,daily_entry_title_property:value.dailyEntryTitleProperty||null,map_object_id:value.mapObjectId||null,
    map_object_type:value.mapObjectType||null,exercise_section_block_id:value.exerciseSectionBlockId||null,timezone:value.timezone||'Asia/Kolkata',
    confirmation_preference:value.confirmationPreference||'risk_based',voice_response_preference:value.voiceResponsePreference!==false,
    default_insertion_behavior:value.defaultInsertionBehavior||'match_existing',updated_at:new Date().toISOString()
  }});
  return value;
}

export async function createAssistantRun(req,res,value){
  const access=await ensureUserAccess(req,res);
  const id=value.id||crypto.randomUUID();
  if(!access.token||!access.session?.user)return {id,persisted:false,access};
  await data(access.token,'assistant_runs',{method:'POST',prefer:'return=minimal',body:{id,user_id:access.session.user.id,input_type:value.inputType,original_transcript:value.transcript,status:value.status||'running',model:value.model||null,normalized_intent:value.intent||{},started_at:new Date().toISOString()}});
  return {id,persisted:true,access};
}

export async function updateAssistantRun(req,res,id,patch){
  const access=await ensureUserAccess(req,res);if(!access.token||!access.session?.user)return false;
  const body={};
  if(patch.status!==undefined)body.status=patch.status;
  if(patch.intent!==undefined)body.normalized_intent=patch.intent;
  if(patch.error!==undefined)body.error_summary=patch.error;
  if(patch.usage!==undefined)body.usage=patch.usage;
  if(['completed','failed','cancelled','partial'].includes(patch.status))body.completed_at=new Date().toISOString();
  await data(access.token,`assistant_runs?id=eq.${q(id)}&user_id=eq.${q(access.session.user.id)}`,{method:'PATCH',prefer:'return=minimal',body});return true;
}

export async function createAssistantAction(req,res,value){
  const access=await ensureUserAccess(req,res);const id=value.id||crypto.randomUUID();
  if(!access.token||!access.session?.user)return {id,persisted:false};
  await data(access.token,'assistant_actions',{method:'POST',prefer:'return=minimal',body:{
    id,run_id:value.runId,user_id:access.session.user.id,tool_name:value.toolName,target_object_id:value.targetId||null,target_title:value.targetTitle||null,
    target_url:value.targetUrl||null,action_type:value.actionType,before_snapshot:value.before||{},after_snapshot:value.after||{},status:value.status||'completed',
    idempotency_key:value.idempotencyKey||null,undo_payload:value.undo||{},undo_status:value.undo?'available':'unavailable'
  }});return {id,persisted:true};
}

export async function getAssistantAction(req,res,id){
  const access=await ensureUserAccess(req,res);if(!access.token||!access.session?.user)return null;
  return first(await data(access.token,`assistant_actions?select=*&id=eq.${q(id)}&user_id=eq.${q(access.session.user.id)}&limit=1`));
}

export async function findActionByIdempotencyKey(req,res,key){
  const access=await ensureUserAccess(req,res);if(!access.token||!access.session?.user||!key)return null;
  return first(await data(access.token,`assistant_actions?select=id,target_title,target_url,status,undo_status&idempotency_key=eq.${q(key)}&user_id=eq.${q(access.session.user.id)}&limit=1`));
}

export async function markAssistantActionUndone(req,res,id,status='undone'){
  const access=await ensureUserAccess(req,res);if(!access.token||!access.session?.user)return false;
  await data(access.token,`assistant_actions?id=eq.${q(id)}&user_id=eq.${q(access.session.user.id)}`,{method:'PATCH',prefer:'return=minimal',body:{undo_status:status,undone_at:status==='undone'?new Date().toISOString():null}});return true;
}

export async function listAssistantRuns(req,res,limit=12){
  const access=await ensureUserAccess(req,res);if(!access.token||!access.session?.user)return [];
  return data(access.token,`assistant_runs?select=id,input_type,original_transcript,status,started_at,completed_at,error_summary&user_id=eq.${q(access.session.user.id)}&order=started_at.desc&limit=${Math.min(25,Math.max(1,limit))}`);
}
