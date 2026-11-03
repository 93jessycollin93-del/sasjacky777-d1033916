const box=document.getElementById("on");
chrome.storage.local.get({on:true},s=>{box.checked=s.on;});
box.onchange=()=>chrome.storage.local.set({on:box.checked});
