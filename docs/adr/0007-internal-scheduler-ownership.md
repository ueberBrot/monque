# ADR-0007: Separate Instance And Processing Lifetimes

Each processing generation owns its polling, notification, stream and schedule resources;
active Job executions, shared reads and started native writes belong to the initialized
Scheduler Instance so stopping cannot cancel side effects or forget occupied capacity.
A stop drains its captured executions and closes only its generation's resources, allowing
a replacement generation to run independently. WorkerAdmission exists before initialization
so synchronous controls and execution capacity retain one owner across initialization and
restarts.
