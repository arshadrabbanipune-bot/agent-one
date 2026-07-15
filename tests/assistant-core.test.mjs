import assert from 'node:assert/strict';
import {assertToolArguments,confirmationDecision,isProgressEvent,resolveRelativeDate,sanitizeForModel} from '../api/_assistantCore.js';
import {decryptNotionToken,encryptNotionToken} from '../api/_store.js';

process.env.TOKEN_ENCRYPTION_KEY='assistant-core-test-key-that-never-leaves-this-process';
const now=new Date('2026-07-14T06:30:00.000Z');
assert.deepEqual(resolveRelativeDate('Add this to today',now,'Asia/Kolkata'),{label:'today',date:'2026-07-14'});
assert.deepEqual(resolveRelativeDate('Aaj workout add karo',now,'Asia/Kolkata'),{label:'today',date:'2026-07-14'});
assert.deepEqual(resolveRelativeDate('कल के लिए task add karo',now,'Asia/Kolkata'),{label:'tomorrow',date:'2026-07-15'});

const safeQuery={collectionId:'12345678-abcd',dateProperty:'Date',dateEquals:'2026-07-14',titleProperty:null,titleContains:null,sortProperty:null,sortDirection:null,pageSize:20};
assert.equal(assertToolArguments('query_notion_collection',safeQuery),safeQuery);
assert.throws(()=>assertToolArguments('query_notion_collection',{...safeQuery,filter:{property:'Date'}}),/strict schema/);
assert.throws(()=>assertToolArguments('query_notion_collection',{...safeQuery,sortDirection:'sideways'}),/sort direction/);

assert.equal(confirmationDecision('append_notion_blocks',{blocks:[{text:'Run'}]},{command:'Add Run to today'}).required,false);
assert.equal(confirmationDecision('archive_notion_object',{objectType:'page'},{command:'archive it'}).required,true);
assert.equal(confirmationDecision('update_notion_block',{type:'paragraph'},{command:'please check it'}).required,true);

assert.deepEqual(sanitizeForModel({title:'Safe',accessToken:'do-not-leak',nested:{secret:'no',value:'yes'}}),{title:'Safe',nested:{value:'yes'}});
assert.equal(isProgressEvent({type:'tool_started'}),true);
assert.equal(isProgressEvent({type:'invented'}),false);

const sealed=encryptNotionToken('notion-secret-token');
assert.notEqual(sealed,'notion-secret-token');
assert.equal(decryptNotionToken(sealed),'notion-secret-token');
const parts=sealed.split('.'),tag=Buffer.from(parts[2],'base64url');tag[0]^=1;parts[2]=tag.toString('base64url');
assert.throws(()=>decryptNotionToken(parts.join('.')));
console.log('assistant core safety contracts passed');
