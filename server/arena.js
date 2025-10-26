// server/arena.js
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

const PORT = process.env.PORT || 4000;

const SUPPLY = 1000;
const FEE_BP = 100; // %1
const TRADE_SECS = 5 * 60;
const BURN_SECS  = 5 * 60;

let state = null;
let burnTimerId = null;
let burnTickId  = null;

function newBotName(){
  const pool=['PEPE','DOGE','WOJAK','FROG','CAT','LAMBO','MOON','NGMI','WAGMI','COOK','SHIB','FLOKI','PONK','GIGA','MEME','TURBO','RUG','APU','KEK','PEPE2'];
  const p=pool[Math.floor(Math.random()*pool.length)];
  const n=Math.floor(100+Math.random()*900);
  return p+n;
}

function createArena(owner){
  const tokens=[];
  const youName = (owner?.tokenName || "PLAYER").toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,24) || "PLAYER";
  tokens.push({ id:1, name:youName, alive:true, vol:0, hold:{ [owner.addr]: SUPPLY } });
  for (let i=2;i<=10;i++){
    const bn = newBotName();
    tokens.push({ id:i, name:bn, alive:true, vol:0, hold:{} });
  }
  state = {
    tokens,
    started:false,
    phase:"lobby", // lobby | trade | burn | done
    tradeLeft:TRADE_SECS,
    burnLeft:BURN_SECS
  };
}

function safeState(){
  const tokens = state.tokens.map(t=>{
    const total = Object.values(t.hold).reduce((a,b)=>a+(b||0),0);
    return { id:t.id, name:t.name, alive:t.alive, vol:t.vol, total };
  });
  return {
    tokens,
    started: state.started,
    phase: state.phase,
    tradeLeft: state.tradeLeft,
    burnLeft: state.burnLeft
  };
}

function broadcast(){ io.to("global").emit("state", safeState()); }
function ensureArena(owner){ if(!state) createArena(owner); }

function startTradePhase(){
  if(!state || state.started) return;
  state.started=true;
  state.phase="trade";
  const tradeInterval = setInterval(()=>{
    if(!state) return clearInterval(tradeInterval);
    state.tradeLeft--;
    if(state.tradeLeft<=0){
      clearInterval(tradeInterval);
      startBurnPhase();
    }
    broadcast();
  }, 1000);
  broadcast();
}

function startBurnPhase(){
  if(!state) return;
  state.phase="burn";
  burnTimerId = setInterval(()=>{
    if(!state) return clearInterval(burnTimerId);
    state.burnLeft--;
    if(state.burnLeft<=0){
      clearInterval(burnTimerId);
      if (burnTickId) clearInterval(burnTickId);
      finishGame();
    }
    broadcast();
  },1000);
  burnTickId = setInterval(()=> burnOne(), 30000);
  broadcast();
}

function finishGame(){ state.phase="done"; broadcast(); }

function burnOne(){
  if(!state) return;
  const alive = state.tokens.filter(t=>t.alive);
  if(alive.length<=2){
    if (burnTickId) { clearInterval(burnTickId); burnTickId=null; }
    finishGame();
    return;
  }
  let min = alive[0];
  for (const t of alive){ if(t.vol < min.vol) min=t; }
  min.alive=false;
  broadcast();
}

function doSwap(addr, fromId, toId, amount){
  if(!state || state.phase!=="trade") return { ok:false, msg:"Trade aşamasında değil" };
  const A = state.tokens.find(t=>t.id===fromId && t.alive);
  const B = state.tokens.find(t=>t.id===toId   && t.alive);
  if(!A||!B) return { ok:false, msg:"Token bulunamadı/yanmış" };
  const bal = A.hold[addr] || 0;
  if(bal < amount) return { ok:false, msg:"Yetersiz bakiye" };
  const fee = Math.floor(amount*FEE_BP/10000);
  const out = amount - fee;
  A.hold[addr] = bal - amount;
  B.hold[addr] = (B.hold[addr]||0) + out;
  A.vol += amount;
  B.vol += out;
  return { ok:true };
}

io.on("connection", (socket)=>{
  socket.join("global");

  socket.on("hello", ({addr})=>{
    if(state) socket.emit("state", safeState());
  });

  socket.on("join", ({ addr, tokenName })=>{
    ensureArena({ addr, tokenName });
    broadcast();
  });

  socket.on("start", ()=>{
    if(!state) return;
    if(state.phase!=="lobby") return;
    startTradePhase();
  });

  socket.on("swap", ({ addr, fromId, toId, amount })=>{
    if(!state) return;
    const res = doSwap(addr, fromId, toId, amount|0);
    socket.emit("swapResult", res);
    if(res.ok) broadcast();
  });

  socket.on("reset", ()=>{
    state = null;
    if (burnTimerId) { clearInterval(burnTimerId); burnTimerId=null; }
    if (burnTickId)  { clearInterval(burnTickId);  burnTickId=null; }
    broadcast();
  });

  socket.on("disconnect", ()=>{});
});

app.get("/", (_req,res)=> res.send("THA Global Arena backend is running"));
server.listen(PORT, ()=> console.log(`✅ THA backend listening on http://localhost:${PORT}`));
