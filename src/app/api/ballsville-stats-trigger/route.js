export const runtime = "edge";

async function dispatch(request) {
  const secret=process.env.CRON_TRIGGER_SECRET;const token=process.env.GITHUB_ACTIONS_TOKEN;
  if(!secret||!token)return Response.json({ok:false,error:"Ballsville update automation is not configured."},{status:503});
  if((request.headers.get("authorization")||"")!==`Bearer ${secret}`)return Response.json({ok:false,error:"Unauthorized."},{status:401});
  const repository=process.env.GITHUB_REPOSITORY||"spickworth1991/the-fantasy-arsenal";const workflow=process.env.GITHUB_BALLSVILLE_WORKFLOW||"update-ballsville-stats.yml";const ref=process.env.GITHUB_VALUES_REF||"main";
  const response=await fetch(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`,{method:"POST",headers:{Accept:"application/vnd.github+json",Authorization:`Bearer ${token}`,"Content-Type":"application/json","User-Agent":"the-fantasy-arsenal-cron","X-GitHub-Api-Version":"2022-11-28"},body:JSON.stringify({ref})});
  if(!response.ok)return Response.json({ok:false,error:"GitHub did not accept the Ballsville update request.",status:response.status},{status:502});
  return Response.json({ok:true,message:"Ballsville statistics update queued.",workflow,ref},{status:202});
}
export async function GET(request){return dispatch(request);}export async function POST(request){return dispatch(request);}
