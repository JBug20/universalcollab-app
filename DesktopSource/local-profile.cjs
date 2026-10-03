const fs=require('node:fs'),path=require('node:path');
function valid(v){if(!v||v.schemaVersion!==1||typeof v.displayName!=='string'||!v.displayName.trim()||v.displayName.trim().length>48)throw Error('Invalid local profile.');return {schemaVersion:1,displayName:v.displayName.trim(),createdAt:typeof v.createdAt==='string'?v.createdAt:new Date().toISOString()};}
exports.createLocalProfileStore=directory=>{
 const file=path.join(directory,'local-profile-v1.json');
 return {load(){return fs.existsSync(file)?valid(JSON.parse(fs.readFileSync(file,'utf8'))):null;},
 save(v){const clean=valid(v);fs.mkdirSync(directory,{recursive:true});if(fs.existsSync(file))fs.copyFileSync(file,file+'.backup');fs.writeFileSync(file+'.tmp',JSON.stringify(clean,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);return clean;}};
};
