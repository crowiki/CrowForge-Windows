const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const db = require('../../packages/db');
const tickets = require('../../modules/tickets');
const {PermissionFlagsBits:P} = require('discord.js');

test('Abrir, assumir e fechar com privacidade e recuperação após falha do Discord',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'crowforge-ticket-'));
  const file=path.join(root,'db');
  let handler, creation, firstPost, edited, rejectEdit=true, channels=0;
  const botId='9000', owner='1000', staff='2000', outsider='3000';
  const channel={id:'channel',send:async post=>{firstPost=post;return {id:'msg'};},
    messages:{fetch:async id=>{
      assert.equal(id,'msg');
      return {id,author:{id:botId},components:firstPost.components,
        edit:async payload=>{if(rejectEdit)throw Error('Discord indisponível');edited=payload;}};
    }},
    permissionOverwrites:{edit:async()=>{}}};
  const guild={id:'guild',name:'Teste',channels:{create:async input=>{channels++;creation=input;return channel;}}};
  async function invoke(customId,id) {
    let response;
    const interaction={customId,user:{id,username:'Pessoa'},guild,guildId:guild.id,channel,channelId:channel.id,
      client:{user:{id:botId}},inGuild:()=>true,isButton:()=>customId!=='crow:ticket:reason',
      isModalSubmit:()=>customId==='crow:ticket:reason',isChatInputCommand:()=>false,
      memberPermissions:{has:()=>false},member:{roles:id===staff?['suporte']:[]},
      fields:{getTextInputValue:()=> 'Preciso de atendimento'},
      deferReply:async()=>{},editReply:async x=>{response=x;},reply:async x=>{response=x.content;}};
    await handler({interaction});
    return response;
  }
  try {
    await db.initDatabase(file);
    db.runSql('INSERT INTO guilds(guild_id,name) VALUES (?,?)',[guild.id,guild.name]);
    for (const [key,value] of [['category_id','categoria'],['staff_role_id','suporte']]) {
      db.runSql('INSERT INTO settings(guild_id,module,key,value) VALUES (?,?,?,?)',[guild.id,'tickets',key,value]);
    }
    await tickets.init({client:{user:{id:botId}},bus:{on:(name,fn)=>{handler=fn;}}});
    await tickets.start();
    await invoke('crow:ticket:reason',owner);
    await invoke('crow:ticket:reason',owner);
    assert.equal(channels,1);
    assert.ok(creation.permissionOverwrites.find(x=>x.id===guild.id).deny.includes(P.ViewChannel));
    for(const id of [botId,owner,'suporte'])assert.ok(creation.permissionOverwrites.find(x=>x.id===id)?.allow.includes(P.ViewChannel));
    assert.match(await invoke('crow:ticket:claim',outsider),/Apenas/);
    await invoke('crow:ticket:claim',staff);
    assert.match(await invoke('crow:ticket:close',outsider),/Apenas/);
    db.closeDatabase();await db.initDatabase(file);
    await invoke('crow:ticket:close',owner);
    assert.equal(db.queryGet('SELECT status FROM tickets').status,'open');
    rejectEdit=false;
    await invoke('crow:ticket:close',owner);
    assert.equal(db.queryGet('SELECT status FROM tickets').status,'closed');
    assert.ok(edited.components[0].toJSON().components.every(b=>b.disabled));
    await invoke('crow:ticket:close',staff);
    assert.deepEqual(db.queryAll('SELECT event_type FROM ticket_events ORDER BY id').map(x=>x.event_type),['created','claimed','closed']);
  } finally {db.closeDatabase();await fs.rm(root,{recursive:true,force:true});}
});
