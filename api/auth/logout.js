export default function handler(req,res){
  // The app calls this endpoint with fetch(). Returning a redirect makes fetch
  // follow the landing page and then fail while trying to parse HTML as JSON.
  // Keep a redirect for a direct browser visit, but make the API action real
  // and predictable for the signed-in UI.
  res.setHeader('Set-Cookie','aos_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  res.setHeader('cache-control','no-store');
  if(req.method==='POST'){
    res.statusCode=200;
    res.setHeader('content-type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ok:true}));
  }
  res.writeHead(303,{Location:'/?signed_out=1'});res.end();
}
