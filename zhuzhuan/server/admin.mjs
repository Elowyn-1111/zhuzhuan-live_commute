import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
const email=process.argv[2];if(!email)throw Error('Usage: node server/admin.mjs registered-email');
const db=new DatabaseSync(resolve(process.env.DATA_DIR||'.local-data','site.sqlite'));
const result=db.prepare("UPDATE users SET role='admin' WHERE email=?").run(email.toLowerCase());
if(!result.changes)throw Error('Register this account first');console.log('Administrator granted to existing account');db.close();
