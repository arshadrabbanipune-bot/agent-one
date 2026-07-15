import {appUrl,configured,consumeOAuthState,env,session,setSession,sendError} from '../../_auth.js';
import {saveNotionConnection} from '../../_store.js';

export default async function handler(req,res){
  const origin=appUrl(req);
  if(!configured('NOTION_CLIENT_ID','NOTION_CLIENT_SECRET','AUTH_SECRET'))return sendError(res,'Notion connection needs its server configuration completed.');
  if(!origin)return sendError(res,'Notion connection needs a valid APP_URL configured on the server.');
  const current=session(req);
  const url=new URL(req.url,origin);
  if(!current||!consumeOAuthState(req,res,'notion',url.searchParams.get('state'))||!url.searchParams.get('code'))return sendError(res,'Notion OAuth state could not be verified. Please restart the connection.',400);
  try{
    const basic=Buffer.from(`${env('NOTION_CLIENT_ID')}:${env('NOTION_CLIENT_SECRET')}`).toString('base64');
    const response=await fetch('https://api.notion.com/v1/oauth/token',{method:'POST',headers:{authorization:`Basic ${basic}`,'content-type':'application/json',accept:'application/json','notion-version':'2026-03-11'},body:JSON.stringify({grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:new URL('/api/auth/notion/callback',origin).toString()})});
    const token=await response.json();
    if(!response.ok||!token.access_token)return sendError(res,token.error_description||token.message||'Notion did not return an access token.',400);
    const notion={token:token.access_token,workspace:token.workspace_name||'Notion workspace',workspaceId:token.workspace_id||''};
    await saveNotionConnection(req,res,notion).catch(()=>false);
    setSession(res,current.user,notion,current.auth);
    res.writeHead(302,{Location:'/?notion_connected=1'});
    res.end();
  }catch{return sendError(res,'Notion could not complete the connection. Please try again.',502);}
}
