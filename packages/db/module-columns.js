// A edição original reservava estas tabelas antes da implementação dos módulos.
const additions = {
  polls: {creator_id:["TEXT DEFAULT ''",'created_by'], options:["TEXT DEFAULT '[]'",'options_json'], mode:["TEXT DEFAULT 'public'","CASE WHEN anonymous=1 THEN 'anonymous' ELSE 'public' END"],multiple_choice:['INTEGER DEFAULT 0'],created_by:["TEXT DEFAULT ''"],options_json:["TEXT DEFAULT '[]'"],anonymous:['INTEGER DEFAULT 0']},
  forms: {creator_id:["TEXT DEFAULT ''",'created_by'],title:["TEXT DEFAULT ''",'form_name'],description:["TEXT DEFAULT ''"],fields:["TEXT DEFAULT '[]'",'fields_json'],channel_id:['TEXT'],message_id:['TEXT'],anonymous:['INTEGER DEFAULT 0'],form_name:["TEXT DEFAULT ''"],form_type:["TEXT DEFAULT 'custom'"],fields_json:["TEXT DEFAULT '[]'"],created_by:["TEXT DEFAULT ''"]},
  form_submissions:{responses:["TEXT DEFAULT '{}'",'answers_json'],answers_json:["TEXT DEFAULT '{}'"]},
  store_products:{creator_id:["TEXT DEFAULT ''"],price:['REAL DEFAULT 0','price_cents / 100.0'],delivery_type:["TEXT DEFAULT 'manual'"],delivery_value:["TEXT DEFAULT ''"],image_url:['TEXT'],price_cents:['INTEGER DEFAULT 0']}
};
module.exports = function migrateModuleColumns(db) {
  db.run('BEGIN');
  try {
    for (const [table,columns] of Object.entries(additions)) {
      const original=new Set(db.exec('PRAGMA table_info('+table+')')[0].values.map(row=>row[1]));
      for (const [name,[type,copy]] of Object.entries(columns)) {
        if (original.has(name)) continue;
        db.run('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type);
        if (copy) db.run('UPDATE '+table+' SET '+name+'='+copy);
      }
    }
    db.run('COMMIT');
  } catch (error) {db.run('ROLLBACK');throw error;}
};
