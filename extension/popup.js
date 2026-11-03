const box=document.getElementById("on"), m=document.getElementById("model");
chrome.storage.local.get({on:true,model:"bonsai",last:""},s=>{box.checked=s.on;m.value=s.model;document.getElementById("last").textContent=s.last;});
box.onchange=()=>chrome.storage.local.set({on:box.checked});
m.onchange=()=>chrome.storage.local.set({model:m.value.trim()||"bonsai"});
