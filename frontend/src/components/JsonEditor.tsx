import { Box, TextField } from '@mui/material';

export function JsonEditor({
  value,
  onChange,
  minRows = 10,
  error,
  helperText,
}: {
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
  error?: boolean;
  helperText?: string;
}) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        '& textarea': {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 13,
          lineHeight: 1.6,
        },
      }}
    >
      <TextField
        value={value}
        onChange={(event) => onChange(event.target.value)}
        fullWidth
        multiline
        minRows={minRows}
        error={error}
        helperText={helperText}
        spellCheck={false}
        inputProps={{ 'aria-label': 'JSON 配置' }}
      />
    </Box>
  );
}