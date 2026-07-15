import {getSessionWithNotion} from '../_store.js';
export default async function handler(req,res){const s=await getSessionWithNotion(req,res);res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');res.end(JSON.stringify({user:s?.user||null,notion:s?.notion?{workspace:s.notion.workspace,workspaceId:s.notion.workspaceId||''}:null}))}
