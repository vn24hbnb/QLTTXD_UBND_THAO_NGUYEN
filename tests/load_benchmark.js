// Local synthetic smoke load; validates HTTP responses, not production capacity.
await import('./setup.js');
const {createServer}=await import('../src/server.js');
const server=createServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const started=performance.now();
try {
 const results=await Promise.all(Array.from({length:100},async(_,i)=>{
  const start=performance.now();
  const response=await fetch(base+(i%2?'/api/public/permits':'/api/health'));
  const body=await response.json();
  if(response.status!==200||body.success!==true)throw new Error(`HTTP ${response.status}: lần ${i+1}`);
  return performance.now()-start;
 }));
 results.sort((a,b)=>a-b);
 console.log(JSON.stringify({requests:results.length,success:results.length,failed:0,duration_ms:Math.round(performance.now()-started),p95_ms:Math.round(results[Math.ceil(results.length*.95)-1]),scope:'HTTP cục bộ với dữ liệu giả lập; không phải chứng nhận năng lực máy chủ sản xuất'},null,2));
} catch(error){console.error(error.message);process.exitCode=1;}finally{await new Promise(resolve=>server.close(resolve));}
