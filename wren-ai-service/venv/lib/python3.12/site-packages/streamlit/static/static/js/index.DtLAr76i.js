import{n as i,k as m,r as c,j as e}from"./index.Phesr84n.js";import{P as l,R as p}from"./RenderInPortalIfExists.NFN1LGqO.js";const d=""+new URL("../media/flake-0.DgWaVvm5.png",import.meta.url).href,f=""+new URL("../media/flake-1.B2r5AHMK.png",import.meta.url).href,S=""+new URL("../media/flake-2.BnWSExPC.png",import.meta.url).href,o=150,r=150,g=10,x=90,E=4e3,n=(t,a=0)=>Math.random()*(t-a)+a,w=()=>m(`from{transform:translateY(0)
      rotateX(`,n(360),`deg)
      rotateY(`,n(360),`deg)
      rotateZ(`,n(360),"deg);}to{transform:translateY(calc(100vh + ",o,`px))
      rotateX(0)
      rotateY(0)
      rotateZ(0);}`),_=i("img",{target:"ehx16tf0"})(({theme:t})=>({position:"fixed",top:`${-o}px`,marginLeft:`${-r/2}px`,zIndex:t.zIndices.balloons,left:`${n(x,g)}vw`,animationDelay:`${n(E)}ms`,height:`${o}px`,width:`${r}px`,pointerEvents:"none",animationDuration:"3000ms",animationName:w(),animationTimingFunction:"ease-in",animationDirection:"normal",animationIterationCount:1,opacity:1})),h=100,s=[d,f,S],u=s.length,I=({particleType:t})=>e(_,{src:s[t]}),M=function({scriptRunId:a}){return e(p,{children:e(l,{className:"stSnow","data-testid":"stSnow",scriptRunId:a,numParticleTypes:u,numParticles:h,ParticleComponent:I})})},P=c.memo(M);export{h as NUM_FLAKES,P as default};
