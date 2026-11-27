let twitchToken;
async function json(url,options={}) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw Error('Provedor retornou HTTP '+response.status);
  return response.json();
}
function configured(type,env=process.env) {
  return type==='twitch' ? Boolean(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET) : Boolean(env.YOUTUBE_API_KEY);
}
async function latest(type,source) {
  if (!configured(type)) return null;
  if (type==='twitch') {
    if (!twitchToken || twitchToken.until<=Date.now()) {
      const body=new URLSearchParams({client_id:process.env.TWITCH_CLIENT_ID,client_secret:process.env.TWITCH_CLIENT_SECRET,grant_type:'client_credentials'});
      const result=await json('https://id.twitch.tv/oauth2/token',{method:'POST',body});
      twitchToken={value:result.access_token,until:Date.now()+(result.expires_in-60)*1000};
    }
    const result=await json('https://api.twitch.tv/helix/streams?user_login='+encodeURIComponent(source),{headers:{'Client-Id':process.env.TWITCH_CLIENT_ID,Authorization:'Bearer '+twitchToken.value}});
    const stream=result.data[0];
    return stream && {id:stream.id,title:stream.title,user:stream.user_name,game:stream.game_name,url:'https://www.twitch.tv/'+stream.user_login};
  }
  const api='https://www.googleapis.com/youtube/v3/';
  const headers={'X-Goog-Api-Key':process.env.YOUTUBE_API_KEY};
  const channels=await json(api+'channels?part=contentDetails&id='+encodeURIComponent(source),{headers});
  const playlist=channels.items[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlist) return null;
  const videos=await json(api+'playlistItems?part=snippet&maxResults=1&playlistId='+encodeURIComponent(playlist),{headers});
  const video=videos.items[0]?.snippet;
  if(!video?.resourceId?.videoId)return null;
  return {id:video.resourceId.videoId,title:video.title,channel:video.videoOwnerChannelTitle||video.channelTitle,url:'https://www.youtube.com/watch?v='+video.resourceId.videoId};
}
module.exports={configured,latest};
