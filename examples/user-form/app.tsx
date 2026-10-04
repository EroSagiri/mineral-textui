import { Screen, Heading, Text, Input, Check, Select, Action, Output, useTextState } from '@mineral/textui-react';

export function UserForm() {
  const [name] = useTextState('name', 'June');
  const [sound] = useTextState('sound', true);
  const [theme] = useTextState('theme', 'dark');
  const [main, setMain] = useTextState('main-count', 0);
  const [preview, setPreview] = useTextState('preview-count', 0);
  const [result, setResult] = useTextState('result', '尚未提交');
  const submit = (where: string) => {
    setResult(`${where}：Name=${name}；sound=${sound ? 'on' : 'off'}；theme=${theme}`);
  };

  // stateKey restores editable values before the batch's Submit handlers run.
  // Repeated Action labels need separate IDs; each counter persists in an Output.
  return (
    <Screen id="user">
      <Heading level={1}>User</Heading>
      <Text>修改字段并保存；勾选 Submit 后提交。</Text>
      <Input label="Name" value={name} stateKey="name" />
      <Check label="Enable sound" checked={sound} stateKey="sound" />
      <Select
        group="theme"
        value={theme}
        stateKey="theme"
        options={[
          { label: 'Light', value: 'light' },
          { label: 'Dark', value: 'dark' },
        ]}
      />

      <Heading level={2}>主表单</Heading>
      <Action id="submit-main" label="Submit" onTrigger={() => {
        setMain(count => count + 1);
        submit('main');
      }} />
      <Output label="Main count" value={main} stateKey="main-count" />

      <Heading level={2}>预览表单</Heading>
      <Action id="submit-preview" label="Submit" onTrigger={() => {
        setPreview(count => count + 1);
        submit('preview');
      }} />
      <Output label="Preview count" value={preview} stateKey="preview-count" />
      <Output label="Result" value={result} stateKey="result" />
    </Screen>
  );
}
