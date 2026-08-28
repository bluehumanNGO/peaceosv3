import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import { Box, FormControl, Input, MenuItem, Select, Stack, Typography } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { CN, ES, FR, GB } from 'country-flag-icons/react/3x2';

import { getTranslation, LANGUAGE_OPTIONS, type Language } from './i18n.js';

function FlagIcon({ flag }: { flag: 'es' | 'gb' | 'fr' | 'cn' }) {
  if (flag === 'es') {
    return <ES title="Spain" style={{ display: 'block', width: '100%', height: '100%' }} />;
  }

  if (flag === 'fr') {
    return <FR title="France" style={{ display: 'block', width: '100%', height: '100%' }} />;
  }

  if (flag === 'cn') {
    return <CN title="China" style={{ display: 'block', width: '100%', height: '100%' }} />;
  }

  return <GB title="United Kingdom" style={{ display: 'block', width: '100%', height: '100%' }} />;
}

function LanguageOption({ language, textColor }: { language: Language; textColor: string }) {
  const option = LANGUAGE_OPTIONS.find((entry) => entry.value === language)!;

  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
      <Box
        sx={{
          width: 22,
          height: 15,
          overflow: 'hidden',
          borderRadius: '1px',
          boxShadow: 'inset 0 0 0 1px rgba(16, 24, 40, 0.12)',
          flex: '0 0 auto',
        }}
      >
        <FlagIcon flag={option.flag} />
      </Box>
      <Typography variant="caption" sx={{ fontWeight: 600, color: textColor }}>
        {option.code}
      </Typography>
    </Stack>
  );
}

export function LanguageSelector({
  language,
  onChange,
}: {
  language: Language;
  onChange: (language: Language) => void;
}) {
  const t = getTranslation(language);

  function handleChange(event: SelectChangeEvent<Language>) {
    onChange(event.target.value as Language);
  }

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
      <HelpOutlineOutlinedIcon sx={{ color: 'rgba(255,255,255,0.88)', fontSize: 19, flex: '0 0 auto' }} />
      <FormControl size="small" sx={{ minWidth: 84 }}>
        <Select
          value={language}
          onChange={handleChange}
          variant="standard"
          input={<Input disableUnderline />}
          aria-label={t.languageSelectorAria}
          renderValue={(value) => <LanguageOption language={value as Language} textColor="#FFFFFF" />}
          MenuProps={{ disableScrollLock: true }}
          sx={{
            minWidth: 0,
            color: 'common.white',
            '.MuiSvgIcon-root': {
              color: 'common.white',
            },
            '&::before, &::after, &:hover:not(.Mui-disabled, .Mui-error)::before': {
              borderBottom: '0 !important',
            },
            '.MuiSelect-select': {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              py: 0.6,
              px: 0.5,
            },
          }}
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value} aria-label={option.name}>
              <LanguageOption language={option.value} textColor="rgba(16, 24, 40, 0.92)" />
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );
}
