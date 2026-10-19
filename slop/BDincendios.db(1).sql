BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS "mediciones" (
	"record_id"	TEXT,
	"schema_version"	TEXT DEFAULT '1.0.0',
	"record_type"	TEXT DEFAULT 'reading',
	"node_id"	TEXT NOT NULL,
	"timestamp"	TEXT NOT NULL,
	"status"	TEXT DEFAULT 'active',
	"alert_level"	TEXT DEFAULT 'normal',
	"temperature"	REAL,
	"humidity"	REAL,
	"wind_speed"	REAL,
	"smoke_level"	REAL,
	"environment"	TEXT DEFAULT 'operational',
	"source_type"	TEXT DEFAULT 'real',
	"alert_evaluated"	INTEGER DEFAULT 1,
	"clock_synced"	INTEGER DEFAULT 1,
	PRIMARY KEY("record_id"),
	FOREIGN KEY("node_id") REFERENCES "nodos"("node_id")
);
CREATE TABLE IF NOT EXISTS "nodos" (
	"node_id"	TEXT,
	"group"	INTEGER DEFAULT 1,
	"subsystem"	TEXT DEFAULT 'Monitoreo de incendios forestales',
	"status"	TEXT DEFAULT 'active',
	PRIMARY KEY("node_id")
);
INSERT INTO "mediciones" VALUES ('5d9f1e9b-5215-4f78-90b3-5cad42a7a390','1.0.0','reading','fire_node_01','2026-10-16T11:00:00Z','active','low',28.5,35.0,NULL,NULL,'test','simulated',1,1);
INSERT INTO "nodos" VALUES ('fire_node_01',1,'Monitoreo de incendios forestales','active');
COMMIT;
