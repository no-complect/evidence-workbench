import json
from types import SimpleNamespace
from unittest.mock import patch
import pytest
from pydantic import ValidationError
from workbench import calibrate_judge as runner
from workbench.config import Settings
from workbench.judge_calibration import load_cases, prepare, score, Prediction, ChallengeSet
from workbench.models import JudgeConfiguration, SemanticJudgment


def server(**kwargs):
    return Settings(_env_file=None, live_enabled=True, openai_api_key='synthetic-test-value',
                    openai_model='test-judge', **kwargs)


def configuration(**kwargs):
    return JudgeConfiguration(model_id='test-judge', tokens=200000, **kwargs)


def response(label='supported', usage=True):
    return {'parsed': SemanticJudgment(label=label, reason='A concise observable explanation.'),
            'raw': SimpleNamespace(usage_metadata={'input_tokens': 100, 'output_tokens': 20}
                                   if usage else None), 'parsing_error': None}


def test_challenges_balance_labels_and_use_production_context_without_reference_leakage():
    dataset = load_cases()
    assert len(dataset.cases) == 18
    assert {case.expected for case in dataset.cases} == {'supported', 'contradicted', 'insufficient'}
    assert all(sum(case.expected == label for case in dataset.cases) == 6
               for label in ['supported', 'contradicted', 'insufficient'])
    for case in dataset.cases:
        content, bound, provenance = prepare(case)
        payload = json.loads(content)
        assert set(payload) == {'claim', 'sources'}
        assert case.annotation not in content
        assert payload['claim'] == case.claim
        assert [source['passage'] for source in payload['sources']] == case.passages
        assert all(source['metadata'] == {} for source in payload['sources'])
        assert bound > len(content.encode()) and provenance['context_policy'].startswith('cited-passages-only')
    assert prepare(dataset.cases[0]) == prepare(dataset.cases[0])


def test_always_supported_judge_exposes_false_approvals_and_label_failures():
    cases = load_cases().cases
    result = score(cases, [{'case_id': c.id, 'status': 'graded',
        'judgment': {'label': 'supported', 'reason': 'Always approve.'}} for c in cases])
    assert result['coverage'] == 1
    assert result['false_support_rate'] == 1
    assert result['false_support_count'] == result['non_supported_graded'] == 12
    assert result['accuracy_on_graded'] == 6 / 18
    assert result['recall_on_graded'] == {'supported': 1, 'contradicted': 0, 'insufficient': 0}


def test_missing_ungraded_and_ambiguous_predictions_are_not_correct_or_perfect():
    cases = load_cases().cases
    result = score(cases, [{'case_id': cases[0].id, 'status': 'reserved'},
                          {'case_id': cases[1].id, 'status': 'ungraded', 'reason': 'Budget'}])
    assert result['graded'] == 0 and result['coverage'] == 0
    assert result['accuracy_on_graded'] is None and result['false_support_rate'] is None
    assert all(row['correct'] is None for row in result['cases'])
    assert result['cases'][2]['status'] == 'missing'
    one = score(cases, [{'case_id': cases[0].id, 'status': 'graded',
                        'judgment': {'label': cases[0].expected, 'reason': 'Stated.'}}])
    assert one['accuracy_on_graded'] == 1 and one['coverage'] == 1 / 18
    assert one['false_support_rate'] is None and one['non_supported_graded'] == 0


def test_duplicate_unknown_and_incoherent_predictions_are_rejected():
    cases = load_cases().cases
    prediction = {'case_id': cases[0].id, 'status': 'ungraded'}
    with pytest.raises(ValueError, match='Duplicate'):
        score(cases, [prediction, prediction])
    with pytest.raises(ValueError, match='unknown'):
        score(cases, [{'case_id': 'nonexistent', 'status': 'ungraded'}])
    for value in [{'case_id': 'x', 'status': 'graded'}, {'case_id': 'x', 'status': 'reserved',
                   'judgment': {'label': 'supported', 'reason': 'Not a final response.'}}]:
        with pytest.raises(ValidationError):
            Prediction.model_validate(value)
    dataset = load_cases().model_dump()
    dataset['cases'].append(dataset['cases'][0])
    with pytest.raises(ValidationError, match='Duplicate'):
        ChallengeSet.model_validate(dataset)


def test_offline_validation_does_not_read_environment_or_construct_a_provider(capsys):
    with patch.object(runner, 'settings', side_effect=AssertionError('No environment read')), patch.object(
            runner.judge_policy, 'SemanticJudge', side_effect=AssertionError('No provider')):
        runner.main([])
    assert json.loads(capsys.readouterr().out)['status'] == 'validated; no model calls'


@pytest.mark.parametrize('allowed,live,key', [(False, True, True), (True, False, True), (True, True, False)])
def test_live_gates_reject_before_provider_or_output(allowed, live, key, tmp_path):
    s = server().model_copy(update={'live_enabled': live, 'openai_api_key': 'synthetic-test-value' if key else ''})
    output = tmp_path / 'result.json'
    with patch.object(runner.judge_policy, 'SemanticJudge') as provider:
        with pytest.raises(ValueError):
            runner.run(load_cases(), configuration(), s, allow_paid=allowed, max_calls=1,
                       case_ids=None, output=output)
        provider.assert_not_called()
    assert not output.exists()


def test_call_cap_pre_call_checkpoint_and_reference_blinding(tmp_path):
    dataset = load_cases()
    output = tmp_path / 'result.json'

    def invoke(content, timeout):
        saved = json.loads(output.read_text())
        assert saved['results'][0]['prediction']['status'] == 'reserved'
        assert saved['accounted_tokens'] > 500 and saved['calls'] == 1
        assert 'expected' not in json.loads(content) and timeout <= 120
        return response()

    with patch.object(runner.judge_policy.SemanticJudge, 'invoke', side_effect=invoke) as call:
        result = runner.run(dataset, configuration(), server(), allow_paid=True,
                            max_calls=1, case_ids=None, output=output)
    assert call.call_count == 1 and result['status'] == 'partial'
    assert result['accounted_tokens'] == 120 and result['estimated_cost_usd'] is None
    assert result['scores']['coverage'] == 1 / 18
    assert all(row['prediction']['reason'] == 'Call limit reached' for row in result['results'][1:])
    assert 'synthetic-test-value' not in output.read_text()
    assert 'max_claims_per_run' not in result['manifest']['judge']['configuration']
    assert result['manifest']['judge']['sampling'].startswith('Selected challenge IDs')


def test_insufficient_token_budget_makes_no_calls(tmp_path):
    with patch.object(runner.judge_policy.SemanticJudge, 'invoke') as call:
        result = runner.run(load_cases(), JudgeConfiguration(model_id='test-judge', tokens=1000),
            server(), allow_paid=True, max_calls=3, case_ids=None, output=tmp_path / 'result.json')
        call.assert_not_called()
    assert result['calls'] == 0 and result['accounted_tokens'] == 0
    assert result['scores']['coverage'] == 0
    assert all('Token reservation' in row['prediction']['reason'] for row in result['results'])


def test_cost_budget_only_uses_pinned_model_rates(tmp_path):
    s = server(model_input_usd_per_million=1000, model_output_usd_per_million=1000)
    with patch.object(runner.judge_policy.SemanticJudge, 'invoke') as call:
        result = runner.run(load_cases(), configuration(estimated_cost_usd=0), s, allow_paid=True,
            max_calls=3, case_ids=None, output=tmp_path / 'result.json')
        call.assert_not_called()
    assert result['calls'] == 0 and result['estimated_cost_usd'] == 0
    assert all('Cost reservation' in r['prediction']['reason'] for r in result['results'])


def test_failed_call_retains_reservation_and_stops_without_sensitive_error(tmp_path):
    output = tmp_path / 'result.json'
    with patch.object(runner.judge_policy.SemanticJudge, 'invoke',
                      side_effect=RuntimeError('private provider body')) as call:
        result = runner.run(load_cases(), configuration(), server(), allow_paid=True,
                            max_calls=6, case_ids=None, output=output)
    assert call.call_count == 1 and result['accounted_tokens'] > 500
    assert result['results'][0]['prediction']['status'] == 'ungraded'
    assert result['scores']['graded'] == 0 and 'private provider body' not in output.read_text()


def test_missing_usage_retains_each_reservation(tmp_path):
    with patch.object(runner.judge_policy.SemanticJudge, 'invoke', return_value=response(usage=False)):
        result = runner.run(load_cases(), configuration(), server(), allow_paid=True,
                            max_calls=2, case_ids=None, output=tmp_path / 'result.json')
    assert result['accounted_tokens'] == sum(r['reserved_tokens'] for r in result['results'][:2])
    assert all(r['usage'] is None for r in result['results'][:2])


def test_invalid_output_stops_but_keeps_reported_usage(tmp_path):
    invalid = response()
    invalid['parsing_error'] = ValueError('private invalid output')
    with patch.object(runner.judge_policy.SemanticJudge, 'invoke', return_value=invalid) as call:
        result = runner.run(load_cases(), configuration(), server(), allow_paid=True,
                            max_calls=6, case_ids=None, output=tmp_path / 'result.json')
    assert call.call_count == 1 and result['accounted_tokens'] == 120
    assert result['results'][0]['prediction']['status'] == 'ungraded'


def test_failed_pre_call_write_prevents_transmission_and_keeps_ambiguous_checkpoint(tmp_path):
    output = tmp_path / 'result.json'
    actual = runner.persist
    calls = 0

    def fail(path, report, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError('disk full')
        actual(path, report, **kwargs)

    with patch.object(runner, 'persist', side_effect=fail), patch.object(
            runner.judge_policy.SemanticJudge, 'invoke') as invoke:
        with pytest.raises(OSError):
            runner.run(load_cases(), configuration(), server(), allow_paid=True,
                       max_calls=1, case_ids=None, output=output)
        invoke.assert_not_called()
    assert json.loads(output.read_text())['calls'] == 0


def test_offline_rescore_rejects_changed_annotations(tmp_path, capsys):
    output = tmp_path / 'result.json'
    with patch.object(runner.judge_policy.SemanticJudge, 'invoke', return_value=response()):
        runner.run(load_cases(), configuration(), server(), allow_paid=True,
                   max_calls=1, case_ids=None, output=output)
    with patch.object(runner, 'settings', side_effect=AssertionError('Offline only')):
        runner.main(['--predictions', str(output)])
    assert json.loads(capsys.readouterr().out)['graded'] == 1
    report = json.loads(output.read_text())
    report['manifest']['dataset_sha256'] = 'changed'
    output.write_text(json.dumps(report))
    with pytest.raises(SystemExit) as exc:
        runner.main(['--predictions', str(output)])
    assert exc.value.code == 2


def test_elapsed_time_and_usage_overrun_stop_further_calls(tmp_path):
    with patch.object(runner.time, 'monotonic', side_effect=[0, 121] + [121] * 30), patch.object(
            runner.judge_policy.SemanticJudge, 'invoke') as call:
        result = runner.run(load_cases(), configuration(), server(), allow_paid=True,
            max_calls=6, case_ids=None, output=tmp_path / 'expired.json')
        call.assert_not_called()
    assert all(r['prediction']['reason'] == 'Time limit reached' for r in result['results'])
    oversized = response()
    oversized['raw'].usage_metadata['input_tokens'] = 210000
    with patch.object(runner.judge_policy.SemanticJudge, 'invoke', return_value=oversized) as call:
        result = runner.run(load_cases(), configuration(), server(), allow_paid=True,
            max_calls=6, case_ids=None, output=tmp_path / 'overrun.json')
        assert call.call_count == 1
    assert result['accounted_tokens'] == 210020
    assert 'exceeded' in result['results'][1]['prediction']['reason']


def test_post_call_write_failure_leaves_reserved_checkpoint_and_no_replay(tmp_path):
    output = tmp_path / 'result.json'
    actual = runner.persist
    calls = 0

    def fail(path, report, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 3:
            raise OSError('disk full')
        actual(path, report, **kwargs)

    with patch.object(runner, 'persist', side_effect=fail), patch.object(
            runner.judge_policy.SemanticJudge, 'invoke', return_value=response()) as invoke:
        with pytest.raises(OSError):
            runner.run(load_cases(), configuration(), server(), allow_paid=True,
                       max_calls=6, case_ids=None, output=output)
        assert invoke.call_count == 1
    saved = json.loads(output.read_text())
    assert saved['results'][0]['prediction']['status'] == 'reserved'
    with patch.object(runner.judge_policy.SemanticJudge, 'invoke') as invoke:
        with pytest.raises(FileExistsError):
            runner.run(load_cases(), configuration(), server(), allow_paid=True,
                       max_calls=1, case_ids=None, output=output)
        invoke.assert_not_called()


@pytest.mark.parametrize('provider', ['openai', 'anthropic'])
def test_native_production_adapter_receives_blinded_case_and_versioned_rubric(monkeypatch, provider, tmp_path):
    from test_report_contract import mock_provider_transport
    observed = mock_provider_transport(monkeypatch, lambda body: {
        'label': 'insufficient', 'reason': 'The source omits the system guarantee. Contact sample@example.invalid.'})
    s = server().model_copy(update={'anthropic_api_key': 'synthetic-anthropic'})
    selected_model = 'anthropic:test-judge' if provider == 'anthropic' else 'test-judge'
    result = runner.run(load_cases(), JudgeConfiguration(model_id=selected_model), s,
        allow_paid=True, max_calls=1, case_ids=['backup-system-overreach'], output=tmp_path / 'result.json')
    assert len(observed) == 1
    body = observed[0]
    messages = body['messages']
    if provider == 'openai':
        assert messages[0]['content'] == runner.judge_policy.rubric()
        content = messages[1]['content']
    else:
        assert runner.judge_policy.rubric() in str(body['system'])
        content = messages[0]['content']
    if isinstance(content, list):
        content = content[0]['text']
    payload = json.loads(content)
    assert set(payload) == {'claim', 'sources'} and len(payload['sources']) == 1
    assert 'annotation' not in content
    assert result['status'] == 'completed' and result['scores']['accuracy_on_graded'] == 1
    assert result['results'][0]['usage']['total_tokens'] == 50
    assert 'sample@example.invalid' not in json.dumps(result)
    assert result['manifest']['prompt_id'] == 'judge-v2'
