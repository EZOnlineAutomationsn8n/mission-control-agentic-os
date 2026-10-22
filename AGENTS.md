# Mission Control OpenClaw Runtime Entry — V1.1

PROJECT=MISSION_CONTROL_AGENTIC_OS
RUNTIME_WORKSPACE=/opt/shared/agentic-sandbox/workspace/projects/mission-control
CANONICAL_BOOTSTRAP=/opt/vireon/workfloor/governance/worker_bootstrap_v1/WORKER_BOOTSTRAP_V1.md
WORKER_ADAPTER=/opt/vireon/workfloor/governance/worker_bootstrap_v1/adapters/OPENCLAW.md
SANDBOX_CONTRACT=/opt/shared/agentic-sandbox/CONTRACT.md
PRODUCT_POLICY=/opt/shared/agentic-sandbox/workspace/projects/mission-control/AGENTIC_OS_BUILD_POLICY.md

Before execution, read those literal paths plus the explicit current work order named by Dennis.
If the caller names a relative work-order path, resolve it ONLY from RUNTIME_WORKSPACE;
never resolve it relative to CANONICAL_BOOTSTRAP, WORKER_ADAPTER, or another project root.
Do not normalize, guess, relocate, or reconstruct authority paths. If a read fails, reread this
file and retry the exact literal path; never create a replacement authority or placeholder file.

Standing files do not define a current task. Historical START_HERE files, old assignment
routing tables, README priorities, session memory, reports, and git branch names are not
current authority unless the current work order explicitly names them.

Stay inside Mission Control. PortMontage, ViREON core, PIP, trading labs, and unrelated
workbench projects remain separate unless Dennis explicitly links them.

Execute bounded work end-to-end, self-correct inside scope, prove the result, then STOP.
A requested file deliverable is complete only after an actual write-tool success and readback
of the exact authorized path. Never represent a MEDIA/path mention as proof of file creation.
For any work order with a required artifact, `NO_REPLY` is forbidden until the artifact is verified.
Required completion sequence: WRITE -> READBACK -> FINAL RESULT -> STOP.
Do not auto-start a next assignment. Tool availability does not create authority.

CURRENT_TASK_EMBEDDED_IN_BOOTSTRAP=NO
BOUNDED_AUTONOMY=YES
NO_AUTOMATIC_NEXT_PASS=YES
