import {appUrl,configured,env,session,startOAuthState,sendError} from '../_auth.js';

export default function handler(req,res){
  const user=session(req);
  if(!user){res.writeHead(302,{Location:'/'});return res.end();}
  if(!configured('NOTION_CLIENT_ID','NOTION_CLIENT_SECRET','AUTH_SECRET'))return sendError(res,'Notion connection needs its server configuration completed.');
  const origin=appUrl(req);
  if(!origin)return sendError(res,'Notion connection needs a valid APP_URL configured on the server.');
  const url=new URL('https://api.notion.com/v1/oauth/authorize');
  url.searchParams.set('client_id',env('NOTION_CLIENT_ID'));
  url.searchParams.set('redirect_uri',new URL('/api/auth/notion/callback',origin).toString());
  url.searchParams.set('response_type','code');
  url.searchParams.set('owner','user');
  url.searchParams.set('state',startOAuthState(res,'notion'));
  res.writeHead(302,{Location:url.toString()});
  res.end();
}
