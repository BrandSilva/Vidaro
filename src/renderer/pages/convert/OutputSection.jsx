import { useEffect, useState } from 'react';
import { FileOutput } from 'lucide-react';
import { Section, Field } from '../../components/Section.jsx';
import { Chip, Select, TextInput } from '../../components/Inputs.jsx';
import { SwitchField } from '../../components/preset/parts.jsx';
import { updateOutput } from '../../state/convert.js';
import { t } from '../../strings/index.js';
import { TEMPLATE_MAX, isValidTemplate, outputExtension, planResolution, previewName, sourceBaseName } from './model.js';

const c = t.convert;
const COLLISIONS = ['rename', 'overwrite', 'skip'];

export function OutputSection({ output, working, sample, plan }) {
  const [template, setTemplate] = useState(output.nameTemplate);

  useEffect(() => {
    setTemplate(output.nameTemplate);
  }, [output.nameTemplate]);

  const valid = isValidTemplate(template);
  const commit = (value) => {
    if (isValidTemplate(value) && value !== output.nameTemplate) updateOutput({ nameTemplate: value });
  };
  const pick = (value) => {
    setTemplate(value);
    commit(value);
  };
  const preview = sample
    ? previewName(valid ? template : output.nameTemplate, {
        name: sourceBaseName(sample.path),
        preset: working ? working.name : '',
        resolution: planResolution(plan),
        extension: outputExtension(working)
      })
    : null;
  const collisions = COLLISIONS.map((value) => ({ value, label: c.collisions[value] }));
  const summary = c.outputSummary(output.nameTemplate, c.collisions[output.collision] || '');

  return (
    <Section title={c.outputTitle} icon={FileOutput} summary={summary} storageKey="cv-output">
      <div className="field-grid cv-output-grid">
        <Field label={c.nameTemplate} span>
          <TextInput
            value={template}
            invalid={!valid}
            maxLength={TEMPLATE_MAX}
            aria-label={c.nameTemplate}
            onChange={setTemplate}
            onCommit={commit}
          />
          {valid ? (
            preview && <div className="cv-name-preview ellipsis">{c.namePreview(preview)}</div>
          ) : (
            <div className="cv-field-error">{c.nameTemplateInvalid}</div>
          )}
          <div className="cv-name-chips">
            {c.nameChips.map((chip) => (
              <Chip key={chip} selected={template === chip} onClick={() => pick(chip)}>
                {chip}
              </Chip>
            ))}
          </div>
          <div className="cv-token-hint">{c.nameTemplateHint}</div>
        </Field>
        <Field label={c.collision}>
          <Select block value={output.collision} options={collisions} label={c.collision} onChange={(value) => updateOutput({ collision: value })} />
        </Field>
        <SwitchField label={c.keepDate} hint={c.keepDateHint} checked={output.keepDate} onChange={(value) => updateOutput({ keepDate: value })} />
      </div>
    </Section>
  );
}
