"""Adapter contract checks; actual container qualification is a separate job."""
import json
import tempfile
import unittest
from pathlib import Path

from harbor.models.agent.context import AgentContext
from benchmarks.harbor.ur_agent import UrAgent


class AdapterTest(unittest.TestCase):
    def test_requires_immutable_version_and_valid_budgets(self):
        with tempfile.TemporaryDirectory() as directory:
            for version in [None, 'latest', '1.2.3; echo unsafe']:
                with self.assertRaises(ValueError):
                    UrAgent(logs_dir=Path(directory), version=version)
            with self.assertRaises(ValueError):
                UrAgent(logs_dir=Path(directory), version='1.2.3', max_turns=0)

    def test_reads_actual_result_and_preserves_unknown_cost(self):
        with tempfile.TemporaryDirectory() as directory:
            logs = Path(directory)
            agent = UrAgent(logs_dir=logs, version='1.2.3', model_name='fixture')
            stream = logs / 'ur-stream.jsonl'
            stream.write_text('ordinary log line\n' + json.dumps({'type': 'result', 'usage': {'input_tokens': 11, 'output_tokens': 7}, 'total_cost_usd': 0, 'cost_status': 'unknown', 'session_id': 'fixture', 'is_error': False}) + '\n')
            context = AgentContext()
            agent.populate_context_post_run(context)
            self.assertEqual(context.n_input_tokens, 11)
            self.assertEqual(context.n_output_tokens, 7)
            self.assertIsNone(context.cost_usd)
            self.assertEqual(context.metadata['session_id'], 'fixture')
            stream.write_text(json.dumps({'type': 'result', 'usage': {}, 'total_cost_usd': .02, 'cost_status': 'known'}))
            agent.populate_context_post_run(context)
            self.assertEqual(context.cost_usd, .02)

    def test_missing_result_is_not_fabricated(self):
        with tempfile.TemporaryDirectory() as directory:
            context = AgentContext()
            UrAgent(logs_dir=Path(directory), version='1.2.3').populate_context_post_run(context)
            self.assertIsNone(context.cost_usd)
            self.assertIsNone(context.n_input_tokens)


if __name__ == '__main__':
    unittest.main()
