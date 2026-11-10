"""Focused native projection regression; fixture is the unchanged external witness.

The fixtures live beside this test in this repository; no external files are required.
Only native wren_core + the independently pinned DuckDB are required.
"""
import base64
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
import duckdb
import wren_core

FIXTURES = Path(__file__).resolve().parent / 'fixtures' / 'relationship_identity'

class RelationshipIdentity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / 'scope_a.duckdb'
        with duckdb.connect(str(self.db)) as c:
            c.execute((FIXTURES / 'fixture.sql').read_text())
        self.mdl = json.loads((FIXTURES / 'mdl.json').read_text())
    def tearDown(self):
        self.temp.cleanup()
    def query(self, sql, mdl=None, expected_names=None):
        ctx = wren_core.SessionContext(base64.b64encode(json.dumps(mdl or self.mdl).encode()).decode(), None, None, 'duckdb')
        expanded = ctx.transform_sql(sql)
        with duckdb.connect() as c:
            c.execute('ATTACH ? AS scope_a (READ_ONLY)', [str(self.db)])
            result = c.execute(expanded)
            names = [d[0] for d in result.description]
            rows = result.fetchall()
        if expected_names is not None:
            self.assertEqual(names, expected_names)
        if os.environ.get('Q02_NATIVE_TEST_RESULTS'):
            with open(os.environ['Q02_NATIVE_TEST_RESULTS'], 'a') as f:
                f.write(json.dumps({'case': self.id(), 'sql': sql, 'native_sql': expanded, 'columns': names, 'rows': rows}) + '\n')
        return rows
    def with_target_id(self):
        mdl = copy.deepcopy(self.mdl)
        finding = next(m for m in mdl['models'] if m['name'] == 'TenderFinding')
        finding['columns'].append({'name': 'project_key', 'type': 'VARCHAR', 'isCalculated': True, 'expression': 'project.id'})
        return mdl
    def test_original_identity_and_shared_project(self):
        self.assertEqual(self.query((FIXTURES/'query.sql').read_text()), [('f1','Project One'),('f2','Project One')])
    def test_projection_order(self):
        self.assertEqual(self.query('SELECT project_name,id FROM "TenderFinding" ORDER BY id'), [('Project One','f1'),('Project One','f2')])
    def test_source_and_target_identity_together(self):
        self.assertEqual(self.query('SELECT id,project_key,project_name FROM "TenderFinding" ORDER BY id', self.with_target_id()), [('f1','p1','Project One'),('f2','p1','Project One')])
    def test_id_only_without_relationship_projection(self):
        self.assertEqual(self.query('SELECT id FROM "TenderFinding" ORDER BY id'), [('f1',),('f2',)])
    def test_public_aliases(self):
        self.assertEqual(self.query('SELECT id AS finding_identity, project_name AS project_label FROM "TenderFinding" ORDER BY finding_identity', expected_names=['finding_identity','project_label']), [('f1','Project One'),('f2','Project One')])
    def test_to_many_distinct_identity_uses_original_dimension(self):
        mdl = copy.deepcopy(self.mdl)
        project = next(m for m in mdl['models'] if m['name'] == 'TenderProject')
        project['columns'].extend([
            {'name':'findings','type':'TenderFinding','relationship':'finding_project'},
            {'name':'finding_count','type':'BIGINT','isCalculated':True,'expression':'COUNT(DISTINCT findings.id)'},
        ])
        self.assertEqual(self.query('SELECT id,finding_count FROM "TenderProject" ORDER BY id', mdl), [('p1',2)])
    def test_null_relationship_preserves_source_identity(self):
        mdl = self.with_target_id()
        finding = next(m for m in mdl['models'] if m['name'] == 'TenderFinding')
        next(c for c in finding['columns'] if c['name']=='project_id')['notNull'] = False
        with duckdb.connect(str(self.db)) as c:
            c.execute('ALTER TABLE src_review_row ALTER COLUMN project_ref DROP NOT NULL')
            c.execute("INSERT INTO src_review_row VALUES ('f3',NULL)")
        self.assertEqual(self.query('SELECT id,project_key,project_name FROM "TenderFinding" ORDER BY id', mdl), [('f1','p1','Project One'),('f2','p1','Project One'),('f3',None,None)])

if __name__=='__main__':
    unittest.main()
