import { Fragment, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, InputHTMLAttributes } from 'react';
import { verifyPackageFiles } from '@peaceos/core/verify';
import type { FileTree } from '@peaceos/core/file-tree';
import type { CheckResult, VerifyReport } from '@peaceos/core';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Collapse,
  Container,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';

import {
  buildFileTreeFromFiles,
  collectDroppedDirectoryFiles,
  type BrowserDirectoryFile,
} from './fileTree.js';
import { getCheckCopy, getStatusDescription, getStatusLabel, getVerdictCopy } from './copy.js';

const LOGO_SRC = '/images/Verify_POS_logo.png';

type DirectoryKind = 'package' | 'transparency';
type StatusTone = 'success' | 'error' | 'warning' | 'info';

interface DirectoryPickerProps {
  title: string;
  description: string;
  tree: FileTree | null;
  onFiles: (files: BrowserDirectoryFile[]) => Promise<void>;
}

async function withNetworkBlocked<T>(action: () => Promise<T>): Promise<{ result: T; networkAttempts: number }> {
  let networkAttempts = 0;
  const originalFetch = window.fetch;
  const originalOpen = window.XMLHttpRequest.prototype.open;

  window.fetch = (() => {
    networkAttempts += 1;
    return Promise.reject(new Error('Network requests are disabled during browser verification.'));
  }) as typeof window.fetch;

  window.XMLHttpRequest.prototype.open = function blockedOpen() {
    networkAttempts += 1;
    throw new Error('Network requests are disabled during browser verification.');
  } as typeof originalOpen;

  try {
    const result = await action();
    if (networkAttempts > 0) {
      throw new Error(`Verification attempted ${networkAttempts} network request(s).`);
    }
    return { result, networkAttempts };
  } finally {
    window.fetch = originalFetch;
    window.XMLHttpRequest.prototype.open = originalOpen;
  }
}

function fileCountLabel(tree: FileTree | null) {
  if (!tree) return 'Sin seleccionar';
  return `${tree.size} ${tree.size === 1 ? 'archivo cargado' : 'archivos cargados'}`;
}

function statusTone(check: CheckResult): StatusTone {
  if (check.id === 'timestamp' && check.status === 'ok') return 'info';
  if (check.status === 'ok') return 'success';
  if (check.status === 'fail') return 'error';
  return 'warning';
}

function statusIcon(check: CheckResult) {
  if (check.status === 'ok') return <CheckCircleOutlineIcon fontSize="small" />;
  if (check.status === 'fail') return <ErrorOutlineIcon fontSize="small" />;
  return <HelpOutlineIcon fontSize="small" />;
}

function statusMeaning(check: CheckResult) {
  return getStatusDescription(check);
}

function DirectoryPicker({ title, description, tree, onFiles }: DirectoryPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputProps = {
    webkitdirectory: '',
    directory: '',
  } as InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string; directory: string };

  async function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    await onFiles(files);
    input.value = '';
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    await onFiles(await collectDroppedDirectoryFiles(event.dataTransfer));
  }

  return (
    <Box
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      sx={(theme) => ({
        py: 1.15,
        borderBottom: 1,
        borderColor: 'divider',
        '&:focus-within': {
          bgcolor: alpha(theme.palette.primary.main, 0.04),
        },
      })}
    >
      <Stack spacing={0.9}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Box
            sx={(theme) => ({
              width: 26,
              height: 26,
              borderRadius: 1,
              display: 'grid',
              flex: '0 0 auto',
              placeItems: 'center',
              color: tree ? 'success.main' : 'primary.main',
              bgcolor: alpha(tree ? theme.palette.success.main : theme.palette.primary.main, 0.1),
            })}
          >
            {tree ? <CheckCircleOutlineIcon fontSize="small" /> : <FolderOutlinedIcon fontSize="small" />}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Typography variant="subtitle1">{title}</Typography>
              <Typography
                variant="caption"
                color={tree ? 'success.main' : 'text.secondary'}
                sx={{ fontWeight: 500, whiteSpace: 'nowrap' }}
              >
                {fileCountLabel(tree)}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          </Box>
        </Stack>

        <input
          {...directoryInputProps}
          ref={inputRef}
          hidden
          aria-label={`Seleccionar ${title}`}
          type="file"
          multiple
          onChange={handleInputChange}
        />
        <Button
          fullWidth
          variant="outlined"
          startIcon={<UploadFileIcon />}
          onClick={() => inputRef.current?.click()}
          sx={{ justifyContent: 'flex-start' }}
        >
          Seleccionar carpeta
        </Button>
      </Stack>
    </Box>
  );
}

function InputRail({
  packageTree,
  transparencyTree,
  loading,
  onLoadDirectory,
  onVerify,
}: {
  packageTree: FileTree | null;
  transparencyTree: FileTree | null;
  loading: boolean;
  onLoadDirectory: (kind: DirectoryKind, files: BrowserDirectoryFile[]) => Promise<void>;
  onVerify: () => Promise<void>;
}) {
  return (
    <Box
      component="aside"
      sx={{
        p: 1.5,
        borderRight: { lg: 1 },
        borderBottom: { xs: 1, lg: 0 },
        borderColor: 'divider',
      }}
    >
      <Stack spacing={1.25}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Entrada local
          </Typography>
          <Typography variant="h2">Archivos necesarios</Typography>
        </Box>

        <DirectoryPicker
          title="Evidencia a verificar (carpeta .vep)"
          description="La carpeta que contiene la evidencia y sus sellos."
          tree={packageTree}
          onFiles={(files) => onLoadDirectory('package', files)}
        />

        <DirectoryPicker
          title="Organizaciones de confianza"
          description="Una copia local del registro público que permite comprobar quién firma la evidencia. Selecciona la carpeta completa, no un archivo suelto."
          tree={transparencyTree}
          onFiles={(files) => onLoadDirectory('transparency', files)}
        />

        {!transparencyTree && (
          <Alert severity="warning" sx={{ py: 0.5 }}>
            Falta la carpeta de organizaciones de confianza. Sin ella no se puede comprobar quién firma la evidencia, y el resultado no será concluyente.
          </Alert>
        )}

        <Button
          fullWidth
          size="small"
          variant="contained"
          startIcon={<ShieldOutlinedIcon />}
          onClick={onVerify}
          disabled={loading || !packageTree}
        >
          Verificar evidencia
        </Button>
      </Stack>
    </Box>
  );
}

function TrustLine() {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pt: 1 }}>
      Verificado en tu propio navegador. Nada se sube a ningún servidor.
    </Typography>
  );
}

function InitialState() {
  return (
    <Box sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="overline" color="text.secondary">
          Resultado
        </Typography>
        <Typography variant="h1">Comprueba si una evidencia es auténtica</Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 760 }}>
          Carga la carpeta de la evidencia y la de organizaciones de confianza. Todo se comprueba aquí mismo, en tu navegador; nada se sube a ningún sitio.
        </Typography>
      </Stack>
    </Box>
  );
}

function LoadingState() {
  return (
    <Box sx={{ p: 2 }}>
      <LinearProgress sx={{ mb: 1.5 }} />
      <Stack spacing={1}>
        <Typography variant="overline" color="text.secondary">
          Verificando
        </Typography>
        <Typography variant="h1">Procesando arbol en memoria</Typography>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
          <Stack key={row} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Skeleton variant="rounded" width={108} height={22} />
            <Skeleton variant="text" width={`${58 - row * 3}%`} />
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

function VerdictBand({
  report,
  packageId,
  copied,
  onCopy,
}: {
  report: VerifyReport;
  packageId: string;
  copied: boolean;
  onCopy: () => Promise<void>;
}) {
  const verdict = getVerdictCopy(report);

  return (
    <Box
      sx={(theme) => ({
        p: 1.5,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: alpha(theme.palette[verdict.tone].main, 0.08),
      })}
    >
      <Stack spacing={1}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box
              sx={(theme) => ({
                width: 32,
                height: 32,
                borderRadius: 1,
                display: 'grid',
                placeItems: 'center',
                color: `${verdict.tone}.main`,
                bgcolor: alpha(theme.palette[verdict.tone].main, 0.13),
              })}
            >
              {report.verdict === 'authentic' ? <VerifiedOutlinedIcon fontSize="small" /> : <ReportProblemOutlinedIcon fontSize="small" />}
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Veredicto
              </Typography>
              <Typography variant="h1" color={`${verdict.tone}.main`}>
                {verdict.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {verdict.text}
              </Typography>
            </Box>
          </Stack>
          <Button variant="outlined" startIcon={<ContentCopyOutlinedIcon />} onClick={onCopy}>
            {copied ? 'Copiado' : 'Copiar huella'}
          </Button>
        </Stack>

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
            Huella del paquete
          </Typography>
          <Typography
            component="p"
            sx={(theme) => ({
              m: 0,
              fontFamily: theme.custom.monoFontFamily,
              fontSize: '0.76rem',
              overflowWrap: 'anywhere',
            })}
          >
            {packageId}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}

function ChecksTable({ checks }: { checks: CheckResult[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <Table size="small" aria-label="Comprobaciones de verificacion">
      <TableHead>
        <TableRow>
          <TableCell sx={{ width: 172 }}>Estado</TableCell>
          <TableCell sx={{ width: 210 }}>Comprobación</TableCell>
          <TableCell>Mensaje</TableCell>
          <TableCell align="right" sx={{ width: 48 }}>
            Detalle técnico
          </TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {checks.map((check) => {
          const tone = statusTone(check);
          const isExpanded = Boolean(expanded[check.id]);
          const copy = getCheckCopy(check);

          return (
            <Fragment key={check.id}>
              <TableRow hover>
                <TableCell>
                  <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
                    <Chip
                      icon={statusIcon(check)}
                      label={getStatusLabel(check)}
                      color={tone}
                      variant={check.status === 'ok' ? 'filled' : 'outlined'}
                      sx={{ height: 22, '& .MuiChip-label': { px: 0.75 } }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {statusMeaning(check)}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell>
                  <Typography variant="subtitle1">{copy.name}</Typography>
                  {check.id === 'timestamp' && (
                    <Typography variant="caption" color="info.main" sx={{ fontWeight: 500 }}>
                      Sin confirmar
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Stack spacing={0.35}>
                    <Typography variant="body2" color="text.primary" sx={{ overflowWrap: 'anywhere' }}>
                      {copy.result}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      {copy.what}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      Por qué importa: {copy.why}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title={isExpanded ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}>
                    <IconButton
                      size="small"
                      aria-label={`${isExpanded ? 'Ocultar' : 'Mostrar'} detalle técnico de ${copy.name}`}
                      onClick={() => setExpanded((current) => ({ ...current, [check.id]: !isExpanded }))}
                    >
                      {isExpanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={4} sx={{ p: 0, borderBottom: isExpanded ? 1 : 0 }}>
                  <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                    <Box sx={{ px: 2, py: 1, bgcolor: 'background.default', borderTop: 1, borderColor: 'divider' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                        Detalle técnico
                      </Typography>
                      <Typography
                        component="pre"
                        sx={(theme) => ({
                          m: 0,
                          mt: 0.5,
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          fontFamily: theme.custom.monoFontFamily,
                          fontSize: '0.74rem',
                        })}
                      >
                        {check.message}
                      </Typography>
                    </Box>
                  </Collapse>
                </TableCell>
              </TableRow>
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ReportView({ report }: { report: VerifyReport }) {
  const [copied, setCopied] = useState(false);
  const packageId = report.packageId ?? '(unknown - manifest failed schema validation)';

  async function copyPackageId() {
    await navigator.clipboard.writeText(packageId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <Box>
      <VerdictBand report={report} packageId={packageId} copied={copied} onCopy={copyPackageId} />

      <Box sx={{ px: 1.5, py: 1 }}>
        <Alert severity="info" icon={<CloudOffOutlinedIcon />} sx={{ py: 0.35 }}>
          Fecha y hora: hay una prueba ligada a este paquete. La confirmación definitiva en la red pública se comprueba aparte y aquí todavía no se ha confirmado.
        </Alert>
      </Box>

      <Divider />

      <Box sx={{ overflowX: 'auto' }}>
        <ChecksTable checks={report.checks} />
      </Box>

      <Box sx={{ px: 1.5, pb: 1 }}>
        <TrustLine />
      </Box>
    </Box>
  );
}

export function App() {
  const [packageTree, setPackageTree] = useState<FileTree | null>(null);
  const [transparencyTree, setTransparencyTree] = useState<FileTree | null>(null);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadDirectory(kind: DirectoryKind, files: BrowserDirectoryFile[]) {
    setError(null);
    setReport(null);
    try {
      const tree = await buildFileTreeFromFiles(files);
      if (kind === 'package') setPackageTree(tree);
      else setTransparencyTree(tree);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function verifyInBrowser() {
    if (!packageTree) {
      setError('Selecciona primero la carpeta de evidencia.');
      return;
    }

    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const { result } = await withNetworkBlocked(() =>
        verifyPackageFiles(packageTree, {
          packagePath: '(browser-selected .vep directory)',
          transparencyFiles: transparencyTree ?? undefined,
        }),
      );
      setReport(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        height: { lg: '100vh' },
        overflow: { lg: 'hidden' },
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AppBar position="static" sx={{ flex: '0 0 auto' }}>
        <Toolbar variant="dense" sx={{ minHeight: 48, gap: 1.25 }}>
          <Box
            component="img"
            src={LOGO_SRC}
            alt="PeaceOS"
            sx={{ width: 30, height: 30, objectFit: 'contain' }}
          />
          <Typography variant="subtitle1" sx={{ color: 'common.white', flex: 1, minWidth: 0 }}>
            PeaceOS Verify
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.76)', whiteSpace: 'nowrap' }}>
            Local · sin red
          </Typography>
        </Toolbar>
      </AppBar>

      <Box
        component="main"
        sx={{
          py: { xs: 1.5, lg: 1.25 },
          flex: { lg: '1 1 auto' },
          minHeight: { lg: 0 },
          overflow: { lg: 'hidden' },
        }}
      >
        <Container maxWidth="xl" sx={{ height: { lg: '100%' }, display: { lg: 'flex' }, minHeight: 0 }}>
          <Paper
            variant="outlined"
            sx={{
              overflow: 'hidden',
              height: { lg: '100%' },
              minHeight: 0,
              width: '100%',
              boxShadow: 'none',
            }}
          >
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', lg: '308px minmax(0, 1fr)' },
                height: { lg: '100%' },
                minHeight: 0,
              }}
            >
              <InputRail
                packageTree={packageTree}
                transparencyTree={transparencyTree}
                loading={loading}
                onLoadDirectory={loadDirectory}
                onVerify={verifyInBrowser}
              />

              <Box
                component="section"
                aria-label="Resultados de verificacion"
                sx={{
                  minWidth: 0,
                  minHeight: 0,
                  height: { lg: '100%' },
                  overflowY: { lg: 'auto' },
                  overflowX: 'hidden',
                }}
              >
                {error && (
                  <Box sx={{ p: 1.5, pb: 0 }}>
                    <Alert severity="error">{error}</Alert>
                  </Box>
                )}
                {loading ? (
                  <LoadingState />
                ) : report ? (
                  <ReportView report={report} />
                ) : (
                  <InitialState />
                )}
              </Box>
            </Box>
          </Paper>
        </Container>
      </Box>
    </Box>
  );
}
