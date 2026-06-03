CREATE CONSTRAINT host_ip IF NOT EXISTS
FOR (h:Host) REQUIRE h.ip IS UNIQUE;

CREATE CONSTRAINT run_id IF NOT EXISTS
FOR (r:Run) REQUIRE r.id IS UNIQUE;

CREATE CONSTRAINT attack_path_id IF NOT EXISTS
FOR (ap:AttackPath) REQUIRE ap.id IS UNIQUE;

CREATE INDEX service_identity IF NOT EXISTS
FOR (s:Service) ON (s.ip, s.port);

CREATE INDEX dead_end_target IF NOT EXISTS
FOR (d:DeadEnd) ON (d.ip);

CREATE INDEX tactic_memory_lookup IF NOT EXISTS
FOR (tm:TacticMemory) ON (tm.serviceType, tm.tool);

CREATE INDEX target_profile_ip IF NOT EXISTS
FOR (tp:TargetProfile) ON (tp.ip);

CREATE INDEX attack_path_service IF NOT EXISTS
FOR (ap:AttackPath) ON (ap.serviceType);
