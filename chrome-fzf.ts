import { spawn, execSync } from 'child_process';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';

type EntryType = 'history' | 'bookmarks';
type ChromeEntry = [string, string, number]; // [title, url, time]

const args = process.argv.slice(2);
const parseArgs = () => {
    const result = {
        listFlag: false,
        type: 'history' as EntryType,
        profile: 'Default'
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--list') {
            result.listFlag = true;
        } else if (args[i] === 'b') {
            result.type = 'bookmarks';
        } else if (args[i] === 'h') {
            result.type = 'history';
        } else if (['-p', '--profile'].includes(args[i]) && i + 1 < args.length) {
            result.profile = args[i + 1];
            i++; // Skip the next argument as it's the profile value
        }
    }

    return result;
};

const { listFlag, type, profile } = parseArgs();

const getWindowsUsername = (): string => {
    try {
        return execSync('powershell.exe echo \'$env:USERPROFILE\'', { encoding: 'utf8' }).trim().split("\\").pop()!;
    } catch (error) {
        console.error('Error detecting Windows username:', error);
        process.exit(1)
    }
};

const CONFIG = {
    USERNAME: getWindowsUsername(),
    BASE_PATH: 'AppData/Local/Google/Chrome/User Data',
    PROFILE: profile,
    OPEN_CMD: 'cmd.exe /c start {+2}',
    CLIP_CMD: 'echo -n {+2} | clip.exe',
};

const getChromePath = (file: string) =>
    `/mnt/c/Users/${CONFIG.USERNAME}/${CONFIG.BASE_PATH}/${CONFIG.PROFILE}/${file}`;

const formatTime = (timeValue: number) =>
    new Date((timeValue / 1000000 - 11644473600) * 1000)
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z$/, '');

const formatEntry = (stream: NodeJS.WritableStream, [title, url, time]: ChromeEntry) => {
    stream.write(`${title || 'Untitled'} (${chalk.yellow(formatTime(time))})\n`);
    stream.write(` · ${chalk.blue.dim(url)}\n\0`);
};

const getHistory = (): ChromeEntry[] => {
    const tempFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-')), 'History');

    try {
        fs.copyFileSync(getChromePath('History'), tempFile);
        const db = new Database(tempFile, { readonly: true });
        return db.query('SELECT title, url, last_visit_time FROM urls ORDER BY last_visit_time DESC')
            .all()
            .map(({ title, url, last_visit_time }: any) => [title || '', url, last_visit_time]);
    } finally {
        try { fs.unlinkSync(tempFile); } catch { }
    }
};

const getBookmarks = (): ChromeEntry[] => {
    const data = JSON.parse(fs.readFileSync(getChromePath('Bookmarks'), 'utf8'));

    const traverse = (parent: string | null, node: any): ChromeEntry[] => {
        const name = parent ? `${parent}/${node.name || ''}` : (node.name || '');

        if (node.type === 'folder' && Array.isArray(node.children)) {
            return node.children.flatMap((child: any) => traverse(name, child));
        } else if (node.url) {
            const time = Math.max(Number(node.date_last_used || 0), Number(node.date_added || 0));
            return [[name, node.url, time]];
        }
        return [];
    };

    return Object.values(data.roots)
        .flatMap((root: any) => traverse(null, root))
        .sort((a, b) => b[2] - a[2]);
};

// FZF command builder
const buildFzfCommand = (type: EntryType): string => {
    const scriptPath = process.argv[1].replace(/(\s+)/g, '\\$1');
    const typeName = type.charAt(0).toUpperCase() + type.slice(1);
    const profileString = CONFIG.PROFILE === 'Default' ? '' : ` (${CONFIG.PROFILE})`;

    return [
        'fzf --ansi --read0 --multi --info inline-right --reverse --scheme history',
        '    --highlight-line --cycle --tmux 100% --wrap --wrap-sign " ↳ "',
        `    --border --border-label " Chrome${profileString}::${typeName} " --delimiter "\\n · "`,
        '    --header "╱ CTRL-B: Bookmarks ╱ CTRL-H: History ╱ CTRL-Y: Copy to clipboard ╱\\n\\n"',
        `    --bind "enter:execute-silent(${CONFIG.OPEN_CMD})+deselect-all"`,
        `    --bind "ctrl-y:execute-silent(${CONFIG.CLIP_CMD})+deselect-all"`,
        `    --bind "ctrl-b:reload(bun ${scriptPath} --list b -p '${CONFIG.PROFILE}')+change-border-label( Chrome${profileString}::Bookmarks )+top"`,
        `    --bind "ctrl-h:reload(bun ${scriptPath} --list h -p '${CONFIG.PROFILE}')+change-border-label( Chrome${profileString}::History )+top"`
    ].join(' \\\n');
};

const listEntries = (type: EntryType, stream = process.stdout) => {
    const items = type === 'history' ? getHistory() : getBookmarks();
    items.forEach(item => formatEntry(stream, item));
};

const runInteractive = (type: EntryType) => {
    try {
        const fzfProcess = spawn('bash', ['-c', buildFzfCommand(type)], {
            stdio: ['pipe', 'inherit', 'inherit']
        });

        listEntries(type, fzfProcess.stdin);
        fzfProcess.stdin.end();
    } catch (error: any) {
        if (error.code !== 'EPIPE') console.error('Error:', error);
    }
};

listFlag ? listEntries(type) : runInteractive(type);

