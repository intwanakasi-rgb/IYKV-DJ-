// Stereo PCM playback with signed rate: negative speeds read audio backwards.
class DeckLabScratch extends AudioWorkletProcessor {
  constructor(){super();this.pcm=null;this.position=0;this.speed=0;this.remaining=0;this.tick=0;
    this.port.onmessage=({data})=>{
      if(data.type==='stop')this.stopped=true;
      if(data.type==='load'){this.pcm=data.channels;this.sourceRate=data.sampleRate;this.position=data.position*this.sourceRate;}
      if(data.type==='move'){this.speed=Math.max(-8,Math.min(8,data.speed));this.remaining=Math.round(sampleRate*.09);}
    };
  }
  process(inputs,outputs){if(this.stopped)return false;const out=outputs[0];if(!this.pcm)return true;
    for(let n=0;n<out[0].length;n++){
      const speed=this.remaining-->0?this.speed:0;
      for(let c=0;c<out.length;c++){
        const pcm=this.pcm[Math.min(c,this.pcm.length-1)], i=Math.floor(this.position), fraction=this.position-i;
        out[c][n]=speed && i>=0 && i<pcm.length-1 ? pcm[i]+(pcm[i+1]-pcm[i])*fraction : 0;
      }
      this.position=Math.max(0,Math.min(this.pcm[0].length-1,this.position+speed*this.sourceRate/sampleRate));
    }
    if(++this.tick%8===0)this.port.postMessage({position:this.position/this.sourceRate});
    return true;
  }
}
registerProcessor('decklab-scratch',DeckLabScratch);
