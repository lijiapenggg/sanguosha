/**
 * 修复 boardgame.io 0.43 的客户端竞态 bug：
 * 客户端在收到 'sync'（初始状态）之前若先收到 'update' 广播，
 * store.getState() 为 null，会抛出 "Cannot read properties of null (reading '_stateID')"。
 * 修复方式：'update' 处理器在未同步完成时直接忽略（sync 本身会带来最新状态）。
 *
 * 幂等：已打补丁的文件不会重复修改。
 * 用途：npm install 后自动执行（见 package.json 的 postinstall），也可手动运行。
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const FILES = [
    'node_modules/boardgame.io/dist/cjs/socketio-e25cdcd1.js',
    'node_modules/boardgame.io/dist/esm/socketio-3299013d.js',
    'node_modules/boardgame.io/dist/boardgameio.js',
];

const MARKER = 'currentState === null';

const OLD = `const currentState = this.store.getState();
            if (matchID == this.matchID &&`;

const NEW = `const currentState = this.store.getState();
            if (currentState === null) return;
            if (matchID == this.matchID &&`;

let patched = 0;
let skipped = 0;

for (const rel of FILES) {
    const file = path.join(root, rel);
    let content;
    try {
        content = readFileSync(file, 'utf8');
    } catch (e) {
        console.log(`⚠ 跳过（文件不存在）: ${rel}`);
        skipped++;
        continue;
    }
    // 统一为 LF 行尾，避免 CRLF 干扰匹配
    content = content.replace(/\r\n/g, '\n');
    if (content.includes(MARKER)) {
        console.log(`✓ 已打过补丁: ${rel}`);
        skipped++;
        continue;
    }
    const count = content.split(OLD).length - 1;
    if (count !== 1) {
        console.log(`⚠ 跳过（匹配 ${count} 处，与预期不符）: ${rel}`);
        skipped++;
        continue;
    }
    writeFileSync(file, content.replace(OLD, NEW), 'utf8');
    console.log(`✓ 已打补丁: ${rel}`);
    patched++;
}

console.log(`\n完成：补丁 ${patched} 个文件，跳过 ${skipped} 个。`);
