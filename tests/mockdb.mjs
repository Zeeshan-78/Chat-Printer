const err=(code,message)=>Object.assign(new Error(message),{code});
export function mockDb(){
  const tables={}, seq={n:0}; const ex={};
  const need=t=>{if(!tables[t])throw err(404,'table not found');return tables[t]};
  const db={
    async get(){if(!ex.db)throw err(404,'db not found');return {}},
    async create(){if(ex.db)throw err(400,'The maximum number of databases allowed for the selected plan has reached.');ex.db=1},
    async createTable({tableId}){if(tables[tableId])throw err(409,'exists');tables[tableId]={rows:new Map(),cols:{},idx:{}}},
    async createStringColumn({tableId,key}){const t=need(tableId);if(t.cols[key])throw err(409,'exists');t.cols[key]=1},
    async createIntegerColumn({tableId,key}){const t=need(tableId);if(t.cols[key])throw err(409,'exists');t.cols[key]=1},
    async createDatetimeColumn({tableId,key}){const t=need(tableId);if(t.cols[key])throw err(409,'exists');t.cols[key]=1},
    async createIndex({tableId,key,type,columns}){const t=need(tableId);if(t.idx[key])throw err(409,'exists');t.idx[key]={type,columns}},
    async getRow({tableId,rowId}){await 0;const r=need(tableId).rows.get(rowId);if(!r)throw err(404,'row not found');return {...r}},
    async createRow({tableId,rowId,data}){await 0;const t=need(tableId);if(t.rows.has(rowId))throw err(409,'exists');
      if(t.idx.tid_unique&&[...t.rows.values()].some(r=>r.tid===data.tid))throw err(409,'dup tid');
      const SYS=['$id','$createdAt'];if(Object.keys(t.cols).length&&Object.keys(data).some(k=>!t.cols[k]))throw err(400,'Invalid document structure: Unknown attribute: "'+Object.keys(data).find(k=>!t.cols[k])+'"');
      const r={$id:rowId==='unique()'?'r'+(++seq.n):rowId,$createdAt:new Date(Date.now()+(++seq.n)).toISOString(),...data};if(tableId==='subscriptions'&&r.totalUsed==null)r.totalUsed=0;t.rows.set(r.$id,r);return {...r}},
    async deleteRow({tableId,rowId}){await 0;if(!need(tableId).rows.delete(rowId))throw err(404,'nf')},
    async updateRow({tableId,rowId,data}){await 0;const t=need(tableId);const r=t.rows.get(rowId);if(!r)throw err(404,'nf');Object.assign(r,data);return {...r}},
    async incrementRowColumn({tableId,rowId,column,value}){await 0;await 0;const r=need(tableId).rows.get(rowId);r[column]=(r[column]||0)+value;return {...r}},
    async decrementRowColumn({tableId,rowId,column,value}){await 0;const r=need(tableId).rows.get(rowId);r[column]=(r[column]||0)-value;return {...r}},
    async listRows({tableId,queries=[]}){await 0;let rows=[...need(tableId).rows.values()];let desc=false,lim=1e9,off=0;
      for(const q of queries.map(x=>JSON.parse(x))){
        if(q.method==='equal')rows=rows.filter(r=>q.values.includes(q.attribute==='$id'?r.$id:r[q.attribute]));
        if(q.method==='lessThan')rows=rows.filter(r=>r[q.attribute]<q.values[0]);
        if(q.method==='greaterThan')rows=rows.filter(r=>r[q.attribute]!=null&&r[q.attribute]>q.values[0]);
        if(q.method==='orderDesc')desc=true;if(q.method==='limit')lim=q.values[0];if(q.method==='offset')off=q.values[0];}
      rows.sort((a,b)=>desc?(a.$createdAt<b.$createdAt?1:-1):(a.$createdAt<b.$createdAt?-1:1));const total=rows.length;return {rows:rows.slice(off,off+lim),total}},
  };return {db,tables};
}
