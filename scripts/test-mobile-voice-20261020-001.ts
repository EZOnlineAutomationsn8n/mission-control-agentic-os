import test from "node:test";
import assert from "node:assert/strict";
import { reconstructSpeechTranscript, type SpeechTranscriptEvent } from "../src/lib/cockpit/speech-transcript";

function event(items: Array<[string, boolean]>, resultIndex = 0): SpeechTranscriptEvent {
  return {
    resultIndex,
    results: Object.assign(items.map(([transcript, isFinal]) => ({isFinal, 0:{transcript}})), {length:items.length}),
  };
}
test("keeps pre-dictation text before cumulative Dutch result indices",()=>{
 const x=reconstructSpeechTranscript("Bestaande notitie",event([["Goedemorgen",true],["dit is een proef",false]]));
 assert.equal(x.text,"Bestaande notitie Goedemorgen dit is een proef");
});
test("repeated final event does not double-append",()=>{
 const e=event([["ja maar jij weet",true]],0);
 const a=reconstructSpeechTranscript("",e);
 const b=reconstructSpeechTranscript("",e);
 assert.equal(a.text,"ja maar jij weet");
 assert.equal(b.text,a.text);
});
test("later resultIndex includes earlier finals exactly once",()=>{
 const a=reconstructSpeechTranscript("Begin",event([["Hallo",true],["hoe gaat het",false]],0));
 const b=reconstructSpeechTranscript("Begin",event([["Hallo",true],["hoe gaat het vandaag",true],["met jou",false]],1));
 assert.equal(a.text,"Begin Hallo hoe gaat het");
 assert.equal(b.text,"Begin Hallo hoe gaat het vandaag met jou");
});
test("interim results are replaced, not appended",()=>{
 const a=reconstructSpeechTranscript("",event([["Ik wil",false]]));
 const b=reconstructSpeechTranscript("",event([["Ik wil een test uitvoeren",false]]));
 assert.equal(a.text,"Ik wil");assert.equal(b.text,"Ik wil een test uitvoeren");
});
test("finalization of the same index never duplicates interim",()=>{
 const a=reconstructSpeechTranscript("",event([["Een gewone zin",false]]));
 const b=reconstructSpeechTranscript("",event([["Een gewone zin",true]]));
 assert.equal(a.text,b.text);
 assert.equal(b.finalText,"Een gewone zin");assert.equal(b.interimText,"");
});
test("legitimate separately indexed repetition is preserved",()=>{
 const x=reconstructSpeechTranscript("",event([["ja",true],["ja",true],["nee",false]],2));
 assert.equal(x.text,"ja ja nee");
});
test("Web Speech result list truncation removes stale interim",()=>{
 const a=reconstructSpeechTranscript("",event([["Vandaag",true],["misschien",false]]));
 const b=reconstructSpeechTranscript("",event([["Vandaag",true]],1));
 assert.equal(a.text,"Vandaag misschien");
 assert.equal(b.text,"Vandaag");
});
test("a blank recognition result does not alter pre-existing text",()=>{
 const a=reconstructSpeechTranscript("Er stond al tekst",event([["",false]]));
 assert.equal(a.text,"Er stond al tekst");
});
