// Real database queries, isolated schema only; external push is replaced by a
// recording stub. This never sends email, push or a booking to real people.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict'),ts=require('typescript'),{PrismaClient}=require('@prisma/client');
const env=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),url=new URL(env.DATABASE_URL);
assert(/^fetch_rider_lab_[a-f0-9]{32}$/.test(url.searchParams.get('schema')));assert.equal(env.LOCAL_DISABLE_PUSH_TRANSPORT,'1');assert.equal(env.GMAIL_APP_PASSWORD,'');
const db=new PrismaClient({datasourceUrl:url.toString(),log:[{emit:'event',level:'query'}]});let queries=0;db.$on('query',()=>queries++);
const sent=[],users=[],jobs=[],tag=crypto.randomBytes(5).toString('hex'),passes=[];
function pass(name){passes.push(name);console.log('PASS '+name);}
function modules(old=false){const cache={};function load(name){if(cache[name])return cache[name];
 if(name==='node:crypto')return crypto;
 if(name==='./db')return{db};
 if(name==='next/server')return{after(){throw Error('No HTTP lifecycle in isolated integration');}};
 if(name==='./automatching')return{};
 if(name==='web-push')return{default:{async sendNotification(subscription,payload){sent.push(JSON.parse(payload));}}};
 const file='src/lib/'+name.replace(/^\.\//,'')+'.ts';const source=old&&['./rider-push-tasks','./push-delivery'].includes(name)?cp.execFileSync('git',['show','4ca512f956f390133efba3a09c883c97dfc29d03:'+file],{encoding:'utf8',windowsHide:true}):fs.readFileSync(file,'utf8');
 const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:load,Date,URL,Buffer,Promise,Set,console,process:{env:{...env,NODE_ENV:'production'}},setTimeout});return exports;
 }return{tasks:load('./rider-push-tasks'),delivery:load('./push-delivery')};}
async function main(){const old=modules(true),current=modules();
 const customer=await db.user.create({data:{email:`latency-${tag}@test.fetchit.invalid`,name:'Isolated alert latency',role:'CUSTOMER'}});users.push(customer.id);
 async function rider(label,{vehicle='SEDAN',service='RIDE',online=true,age=0,sub=true,banned=false,authReset=false}={}){
  const row=await db.user.create({data:{email:`latency-${tag}-${label}@test.fetchit.invalid`,name:'Isolated '+label,role:'RIDER',isBanned:banned,authInvalidBefore:authReset?new Date(Date.now()+10000):null,riderProfile:{create:{vehicleClass:vehicle,vehiclePlate:'LOCAL-'+label}},riderPresence:{create:{isOnline:online,lat:16.0206,lng:120.2321,locationAt:new Date(Date.now()-age),locationAccuracy:10}},riderApprovals:{create:{vehicleClass:vehicle,service,source:'OWNER_PERSONA'}}}});users.push(row.id);
  if(sub)await db.customerPushSubscription.create({data:{customerId:row.id,deviceId:tag+label,endpoint:'https://fcm.googleapis.com/fcm/send/local-alert-'+tag+label,p256dh:'local-stub',auth:'local-stub'}});
  return row;
 }
 const good=await rider('eligible');await rider('offline',{online:false});await rider('stale',{age:180000});await rider('vehicle',{vehicle:'MOTORCYCLE'});await rider('service',{service:'DELIVERY'});await rider('nosub',{sub:false});await rider('banned',{banned:true});await rider('reset',{authReset:true});const busy=await rider('busy');
 async function booking(extra={}){const row=await db.booking.create({data:{refCode:'LOCAL-ALERT-'+crypto.randomBytes(4).toString('hex'),customerId:customer.id,type:'RIDE',vehicleClass:'SEDAN',status:'PENDING',pickupLabel:'Isolated Lingayen',pickupLat:16.0206,pickupLng:120.2321,dropoffLabel:'Isolated Dagupan',dropoffLat:16.0434,dropoffLng:120.334,baseFare:100,totalFare:200,distanceKm:14,...extra}});jobs.push(row.id);return row;}
 await booking({riderId:busy.id,status:'ACCEPTED'});
 const job=await booking();await db.autoDispatch.create({data:{bookingId:job.id,phase:'OPEN'}});
 const task='local-alert-'+tag;
 const makeTask=(kind='NEW_REQUEST',riderId=null)=>db.$executeRaw`INSERT INTO "RiderNotificationTask" ("id","bookingId","kind","riderId") VALUES (${task},${job.id},${kind},${riderId})`;
 await db.webPushIdentity.upsert({where:{id:'customer'},create:{id:'customer',publicKey:'local-stub',privateKey:'local-stub'},update:{}});
 // Old worker is intentionally run first; the comparison never changes live data.
 async function trial(api,scoped,kind='NEW_REQUEST'){await makeTask(kind,kind==='ASSIGNED'?good.id:null);const start=performance.now(),before=queries;await api.delivery.deliverPendingNotifications(...(scoped?[job.id]:[]));const result={ms:Math.round(performance.now()-start),queries:queries-before};
  const notices=await db.customerNotification.findMany({where:{bookingId:job.id}});assert.deepEqual(notices.map(n=>n.customerId),[good.id]);assert.equal(sent.at(-1).customerId,good.id);
  await db.customerNotification.deleteMany({where:{bookingId:job.id}});await db.$executeRaw`DELETE FROM "RiderNotificationTask" WHERE "id"=${task}`;return result;
 }
 const before=await trial(old,false),after=await trial(current,true);assert(after.queries<before.queries);pass('eligible rider alone receives alert; offline, stale, banned, wrong vehicle/service, busy, missing/revoked subscription excluded');
 pass('real database delivery uses fewer queries than previous release');
 await db.booking.update({where:{id:job.id},data:{status:'MATCHED',riderId:good.id,assignmentExpiresAt:new Date(Date.now()+120000)}});
 const offerBefore=await trial(old,false,'ASSIGNED'),offerAfter=await trial(current,true,'ASSIGNED');assert(offerAfter.queries<offerBefore.queries);pass('exclusive assigned offers notify only their rider with fewer database queries');
 await db.booking.update({where:{id:job.id},data:{status:'PENDING',riderId:null,assignmentExpiresAt:null}});
 // Targeted delivery must leave unrelated queued work unclaimed.
 const unrelated=await booking();await db.autoDispatch.create({data:{bookingId:unrelated.id,phase:'OPEN'}});await db.$executeRaw`INSERT INTO "RiderNotificationTask" ("id","bookingId","kind") VALUES (${task+'-other'},${unrelated.id},'NEW_REQUEST')`;
 await makeTask();const sentBefore=sent.length;await Promise.all([current.delivery.deliverPendingNotifications(job.id),current.delivery.deliverPendingNotifications(job.id)]);assert.equal((await db.$queryRaw`SELECT "processedAt" FROM "RiderNotificationTask" WHERE "id"=${task+'-other'}`)[0].processedAt,null);pass('fresh-booking delivery does not consume unrelated backlog');
 assert.equal(await db.customerNotification.count({where:{bookingId:job.id}}),1);assert.equal(sent.length-sentBefore,1);pass('simultaneous workers produce one inbox item and one outbound push');
 const notice=(await db.customerNotification.findMany({where:{bookingId:job.id}}))[0];assert(await current.tasks.riderPushStillRelevant(db,notice));
 await db.riderPresence.update({where:{userId:good.id},data:{isOnline:false}});assert.equal(await current.tasks.riderPushStillRelevant(db,notice),false);await db.riderPresence.update({where:{userId:good.id},data:{isOnline:true,locationAt:new Date()}});pass('send-time recheck rejects a rider who went offline after inbox creation');
 await db.booking.update({where:{id:job.id},data:{status:'MATCHED',riderId:good.id,assignmentExpiresAt:new Date(Date.now()-1000)}});assert.equal(await current.tasks.riderPushStillRelevant(db,{...notice,sourceId:'rider:assigned:'+task}),false);assert.equal(await current.tasks.riderPushStillRelevant(db,notice),false);pass('expired offers and already-assigned open requests do not trigger stale push');
 await db.booking.update({where:{id:job.id},data:{status:'CANCELLED'}});assert(await current.tasks.riderPushStillRelevant(db,{...notice,sourceId:'rider:cancelled:'+task}));assert.equal(await current.tasks.riderPushStillRelevant(db,{...notice,sourceId:'rider:cancelled:'+task,customerId:busy.id}),false);pass('cancellation reaches only the assigned rider');
 const tri=await rider('tricycle',{vehicle:'TRICYCLE'}),triJob=await booking({vehicleClass:'TRICYCLE'});
 const triNotice={...notice,bookingId:triJob.id,customerId:tri.id};await db.autoDispatch.create({data:{bookingId:triJob.id,phase:'OPEN'}});
 assert.equal(await current.tasks.riderPushStillRelevant(db,triNotice),false);
 await db.riderServiceApproval.updateMany({where:{userId:tri.id},data:{operatingZone:[[120.1,15.9],[120.5,15.9],[120.5,16.2],[120.1,16.2],[120.1,15.9]]}});
 assert(await current.tasks.riderPushStillRelevant(db,{...triNotice,customerId:tri.id}));
 await db.riderServiceApproval.updateMany({where:{userId:tri.id},data:{revokedAt:new Date()}});
 assert.equal(await current.tasks.riderPushStillRelevant(db,{...triNotice,customerId:tri.id}),false);pass('tricycle operating-zone coverage and revoked service approval remain enforced');
 console.log(JSON.stringify({passed:passes.length,before,after,offerBefore,offerAfter,note:'Isolated database; push transport stubbed. These are not phone delivery timings.'}));
 if(process.env.NOTIFICATION_RESULT_FILE)fs.writeFileSync(process.env.NOTIFICATION_RESULT_FILE,JSON.stringify({passed:passes.length,passes,before,after,offerBefore,offerAfter},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{try{await db.booking.deleteMany({where:{id:{in:jobs}}});await db.user.deleteMany({where:{id:{in:users}}});}finally{await db.$disconnect();}});
