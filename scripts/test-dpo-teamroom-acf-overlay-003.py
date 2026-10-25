#!/usr/bin/env python3
import pathlib
import sys

ROOT=pathlib.Path.cwd()/".preview-acf-runtime"
sys.path.insert(0,str(ROOT/"src"))
sys.path.insert(0,str(ROOT/"runtime"))

from acf_runtime.dialogue.transport import ParticipantRoute, INITIATOR_CONTRACT
from acf_runtime.team_room import classify

CONTRACT="MC_PREPARED_FIRST_TURN_V1"

class Client:
    route="http://stage.invalid/ask"
    def __init__(self,payload):
        self.payload=payload
    def session(self,_session_ref):
        return 200,self.payload

class Route:
    def describe(self):
        return {"initiator_contract":INITIATOR_CONTRACT}

def payload(ready):
    return {
        "session":{
            "sessionKey":"acf-werkplaats-claude-code",
            "status":"prepared",
            "active":True,
        },
        "firstTurnReadiness":{
            "contract":CONTRACT,
            "ready":ready,
            "code":"FCC_STAGE_RELAY_CONNECTED" if ready else "FCC_STAGE_RELAY_UNKNOWN",
        },
    }

ready_route=ParticipantRoute("claude-code",Client(payload(True)),initiator_contract=INITIATOR_CONTRACT)
assert ready_route.session_state("acf-werkplaats-claude-code")["state"]=="FIRST_TURN_READY"

blocked_route=ParticipantRoute("claude-code",Client(payload(False)),initiator_contract=INITIATOR_CONTRACT)
assert blocked_route.session_state("acf-werkplaats-claude-code")["state"]=="UNCLEAR"

candidate={
    "agentId":"claude-code",
    "sessionId":"acf-werkplaats-claude-code",
    "status":"prepared",
    "active":True,
    "executionMode":"on-demand-cli",
    "firstTurnReadiness":{"contract":CONTRACT,"ready":True,"code":"FCC_STAGE_RELAY_CONNECTED"},
}
verdict,reason=classify(candidate,{"claude-code":Route()},r"^acf-werkplaats-[a-zA-Z0-9_-]{1,48}$",{},False)
assert verdict=="ELIGIBLE_FIRST_TURN",(verdict,reason)

blocked=dict(candidate)
blocked["firstTurnReadiness"]={"contract":CONTRACT,"ready":False,"code":"STAGE_NATIVE_KEY_MISSING"}
verdict,reason=classify(blocked,{"claude-code":Route()},r"^acf-werkplaats-[a-zA-Z0-9_-]{1,48}$",{},False)
assert verdict=="EXCLUDED_UNCLEAR",(verdict,reason)
assert "STAGE_NATIVE_KEY_MISSING" in reason

print("ACF_FIRST_TURN_CONTRACT_TEST=PASS")
print("MODEL_OR_PROVIDER_CALLS=0")
