export async function POST(request:Request){
  const key=request.headers.get('x-review-key');
  if(!key||key.length<15)return Response.json({error:'Enter a valid Gemini API key.'},{status:400});
  try{
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(15000)});
    if(!response.ok)return Response.json({error:response.status===429?'Gemini is rate-limited. Try again shortly.':'Gemini could not validate this key. Check its permissions and API access.'},{status:response.status===429?429:401});
    const data=await response.json() as {models?:{name:string;displayName:string;supportedGenerationMethods?:string[]}[]};
    const models=(data.models??[]).filter(m=>m.supportedGenerationMethods?.includes('generateContent')&&m.name.includes('gemini')&&!/image|tts|robotics|embedding|live|computer-use/.test(m.name)).map(m=>({id:m.name.replace('models/',''),name:m.displayName}));
    return Response.json({models},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'Could not reach Gemini. Check your network and try again.'},{status:502});}
}
