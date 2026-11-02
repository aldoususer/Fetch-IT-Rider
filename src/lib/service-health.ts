import {after} from 'next/server';
import {db} from './db';
import {recordServiceHealth} from './staff-notifications';
export function scheduleServiceHealth(scope:string,status:number){
 if(!/road-route|bookings/.test(scope))return;
 try{after(async()=>{try{await recordServiceHealth(db,scope,status);}catch{console.warn('Service health sample could not be stored. External uptime monitoring remains necessary.');}});}catch{/* No request lifecycle exists in CLI/unit test contexts. */}
}
