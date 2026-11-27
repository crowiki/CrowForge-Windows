async function checkIntents(token, request) {
 try {
   const response = await request('https://discord.com/api/v10/applications/@me', {Authorization:'Bot ' + token});
   const flags = response.data?.flags;
   if (response.status !== 200 || !Number.isInteger(flags)) return {available:false};
   return {
     available:true,
     members:Boolean(flags & ((1 << 14) | (1 << 15))),
     content:Boolean(flags & ((1 << 18) | (1 << 19)))
   };
 } catch { return {available:false}; }
}

module.exports = {checkIntents};
