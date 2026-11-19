CREATE TABLE src_project(key_id VARCHAR PRIMARY KEY, caption VARCHAR NOT NULL);
CREATE TABLE src_review_row(row_id VARCHAR PRIMARY KEY, project_ref VARCHAR NOT NULL);
INSERT INTO src_project VALUES ('p1','Project One');
INSERT INTO src_review_row VALUES ('f1','p1'),('f2','p1');
