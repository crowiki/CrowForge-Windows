const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildServer} = require('../../apps/local-api');
test('Loopback aceita a própria origem e recusa hosts e origens externos',async t=>{
  const app = await buildServer();
  t.after(()=>app.close());
  const host='127.0.0.1:3000';
  const check=headers=>app.inject({url:'/health',headers});
  assert.equal((await check({host,origin:'http://'+host})).statusCode,200);
  assert.equal((await check({host,origin:'https://externo.invalid'})).statusCode,403);
  assert.equal((await check({host:'externo.invalid'})).statusCode,403);
  assert.equal((await check({host,'sec-fetch-site':'cross-site'})).statusCode,403);
});
