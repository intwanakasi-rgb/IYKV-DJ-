const form=document.getElementById('submission'),status=document.getElementById('status');
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try{
    const data=new FormData(form),file=data.get('audio');
    if(!file?.size||file.size>50*1024*1024)throw Error('Choose an audio file up to 50 MB');
    const query=new URLSearchParams({artist:data.get('artist'),title:data.get('title'),permission:data.get('permission')?'yes':'no',explicit:data.get('explicit')?'yes':'no'});
    status.textContent='Uploading…';
    const response=await fetch('/upload/'+location.pathname.split('/').pop()+'?'+query,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
    const result=await response.json();if(!response.ok)throw Error(result.error);
    status.textContent=result.message;form.reset();
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
});
