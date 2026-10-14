const key='central.accessToken.v1';

export function loadSavedAccessToken(storage) {
  try {
    const value=JSON.parse(storage.getItem(key)||'null');
    if(value?.remember===true&&typeof value.token==='string'&&value.token.length>0&&value.token.length<=4096)return {token:value.token,remember:true};
  } catch { /* Missing or unavailable storage starts without a saved credential. */ }
  return {token:'',remember:false};
}

export function persistAccessToken(storage,token,remember) {
  if(remember&&token)storage.setItem(key,JSON.stringify({token,remember:true}));
  else storage.removeItem(key);
}
