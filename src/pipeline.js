/*
 * MiniC 管线对照页：源码 → 生成的指令序列 → 执行结果
 *
 * 关键性质：三个栏目共用同一份数据。
 *   - 「指令序列」列是沙盒编译器（Blazor2.dll, Init）的反汇编输出，
 *     并且逐单元格与 VM 内存（MemorySlice + OpCodeToString）核对；
 *   - 「执行结果」列在执行前读取 VM 的程序计数器 IP，
 *     按地址到同一份指令清单里查表得到——VM 跑的就是页面上看到的指令。
 */

// 来自沙盒自带教程（main.js）与沙盒默认程序的演示用例
const PROGRAMS = [
    {
        id: 'arith',
        title: '① 算术表达式（教程 Part 1）',
        source: 'int main() {\n    return 132 - 531;\n}',
        expected: -399,
    },
    {
        id: 'precedence',
        title: '② 运算符优先级（教程 Part 2）',
        source: 'int main() {\n    return 2 + 5 * 3;\n}',
        expected: 17,
    },
    {
        id: 'vars',
        title: '③ 变量与链式赋值（教程 Part 4）',
        source: 'int main() {\n    int a = 3;\n    int b = a = 5;\n    return b;\n}',
        expected: 5,
    },
    {
        id: 'recursion',
        title: '④ 递归函数调用（沙盒默认程序）',
        source: 'int main() {\n    return sum(5);\n}\n\nint sum(int n) {\n    if (!n) return 0;\n    return 1 + sum(n - 1);\n}',
        expected: 5,
    },
    {
        id: 'while',
        title: '⑤ while 循环（JMP / JZ 跳转）',
        source: 'int main() {\n    int i = 0;\n    int s = 0;\n    while (i < 4) {\n        s += i;\n        i += 1;\n    }\n    return s;\n}',
        expected: 6,
    },
];

function invoke() {
    return DotNet.invokeMethod(...['Blazor2', ...arguments]);
}

// 轮询直到 Blazor/Mono 运行时就绪（与沙盒 src/main.js 同一做法）
function waitForVm(ready) {
    const interval = setInterval(() => {
        try {
            invoke('Init', 'int main(){return 2+2;}');
            clearInterval(interval);
            ready();
        } catch (error) {
            // blazor not initialized yet
        }
    }, 100);
}

// 把编译器的反汇编输出（PrintInstructions）解析成有序条目：
// 源码行 { kind: 'src' } 或指令行 { kind: 'instr', addr, op, arg, text }
function parsePrinted(printed) {
    const items = [];
    for (const raw of printed.split('\n')) {
        const m = raw.match(/^\s*(\d+)\s+([A-Z]+)(?:\s+(-?\d+))?\s*$/);
        if (m) {
            items.push({
                kind: 'instr',
                addr: Number(m[1]),
                op: m[2],
                arg: m[3] === undefined ? undefined : Number(m[3]),
                text: m[2] + (m[3] === undefined ? '' : ' ' + m[3]),
            });
        } else if (raw.trim() !== '') {
            items.push({ kind: 'src', text: raw.trim() });
        }
    }
    return items;
}

// 校验①：展示的每条指令与 VM 内存逐单元格一致
// （内存[addr] 经 OpCodeToString 解码必须等于展示的助记符，参数单元格必须等于展示的参数）
function verifyListingAgainstMemory(items) {
    const mismatches = [];
    for (const it of items) {
        if (it.kind !== 'instr') continue;
        const cells = invoke('MemorySlice', it.addr, it.arg === undefined ? 1 : 2);
        const decoded = invoke('OpCodeToString', Number(cells[0]));
        if (decoded !== it.op) {
            mismatches.push(`${it.addr}: 清单=${it.op} 内存=${decoded}`);
        }
        if (it.arg !== undefined && cells[1] !== it.arg) {
            mismatches.push(`${it.addr}: 清单参数=${it.arg} 内存=${cells[1]}`);
        }
    }
    return mismatches;
}

// 执行并记录轨迹：每一步先读 IP，到展示清单里按地址查出指令，再让 VM 单步执行
function runAndTrace(items) {
    const byAddr = new Map();
    for (const it of items) {
        if (it.kind === 'instr') byAddr.set(it.addr, it);
    }
    const trace = [];
    const execCount = new Map();
    const foreign = [];
    let guard = 0;
    while (true) {
        const ip = invoke('IP');
        const line = byAddr.get(ip);
        if (line) {
            trace.push(line);
            execCount.set(ip, (execCount.get(ip) || 0) + 1);
        } else {
            foreign.push(ip);
        }
        if (!invoke('Step')) break;
        if (++guard > 200000) throw new Error('执行步数超限，疑似死循环');
    }
    const ret = invoke('MemorySlice', invoke('SP'), 1)[0];
    return { trace, execCount, foreign, ret };
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function checkRow(ok, label, detail) {
    const row = el('div', 'check ' + (ok ? 'check-ok' : 'check-fail'));
    row.appendChild(el('span', 'check-mark', ok ? '✓' : '✗'));
    row.appendChild(el('span', 'check-label', label));
    if (detail) row.appendChild(el('span', 'check-detail', detail));
    return row;
}

function renderProgram(program) {
    // 编译：源码 → VM 内存中的指令
    invoke('Init', program.source);
    const items = parsePrinted(invoke('PrintInstructions'));

    // 校验①：清单 == 内存镜像
    const mismatches = verifyListingAgainstMemory(items);

    // 执行：VM 单步跑同一份指令，记录轨迹与最终输出
    const { trace, execCount, foreign, ret } = runAndTrace(items);

    const card = el('section', 'card');
    card.appendChild(el('h2', 'card-title', program.title));

    const grid = el('div', 'grid');

    // 栏目一：源码
    const colSrc = el('div', 'col');
    colSrc.appendChild(el('div', 'col-head', '① 源码（C）'));
    colSrc.appendChild(el('pre', 'source', program.source));
    grid.appendChild(colSrc);

    // 栏目二：生成的指令序列（被执行次数标注 + 高亮）
    const colInstr = el('div', 'col');
    colInstr.appendChild(el('div', 'col-head', '② 生成的指令序列（VM 内存镜像）'));
    const instrBox = el('pre', 'instrs');
    for (const it of items) {
        if (it.kind === 'src') {
            instrBox.appendChild(el('div', 'src-line', it.text));
            continue;
        }
        const count = execCount.get(it.addr) || 0;
        const row = el('div', 'instr' + (count ? ' instr-hit' : ''));
        row.appendChild(el('span', 'addr', String(it.addr)));
        row.appendChild(el('span', 'op', it.text));
        row.appendChild(el('span', 'count', count ? '×' + count : ''));
        instrBox.appendChild(row);
    }
    colInstr.appendChild(instrBox);
    grid.appendChild(colInstr);

    // 栏目三：执行结果（逐条执行的指令 + 最终输出）
    const colRun = el('div', 'col');
    colRun.appendChild(el('div', 'col-head', `③ 执行结果（共 ${trace.length} 步）`));
    const traceBox = el('pre', 'trace');
    trace.forEach((line, i) => {
        const row = el('div', 'trace-row');
        row.appendChild(el('span', 'step', '#' + (i + 1)));
        row.appendChild(el('span', 'addr', String(line.addr)));
        row.appendChild(el('span', 'op', line.text));
        traceBox.appendChild(row);
    });
    colRun.appendChild(traceBox);
    const resultBox = el('div', 'result' + (ret === program.expected ? ' result-ok' : ' result-fail'));
    resultBox.appendChild(el('span', 'result-label', 'main() 返回值'));
    resultBox.appendChild(el('span', 'result-value', String(ret)));
    resultBox.appendChild(el('span', 'result-expected', `（预期 ${program.expected}）`));
    colRun.appendChild(resultBox);
    grid.appendChild(colRun);

    card.appendChild(grid);

    // 一致性校验
    const checks = el('div', 'checks');
    checks.appendChild(checkRow(
        mismatches.length === 0,
        '展示的指令 == VM 内存中的指令',
        mismatches.length === 0
            ? '逐单元格核对（MemorySlice / OpCodeToString）全部一致'
            : '不一致: ' + mismatches.join('; ')
    ));
    checks.appendChild(checkRow(
        foreign.length === 0,
        '执行的指令 == 展示的指令',
        foreign.length === 0
            ? `${trace.length} 步执行轨迹逐条按 IP 地址命中清单，无一清单外指令`
            : '出现清单外指令地址: ' + foreign.join(', ')
    ));
    checks.appendChild(checkRow(
        ret === program.expected,
        '最终输出 == 预期结果',
        `main() 返回 ${ret}，预期 ${program.expected}`
    ));
    card.appendChild(checks);

    return { card, ok: mismatches.length === 0 && foreign.length === 0 && ret === program.expected };
}

function main() {
    const root = document.getElementById('pipeline-root');
    root.textContent = '';

    const header = el('header', 'page-header');
    header.appendChild(el('h1', '', 'MiniC 管线三截对照：源码 → 指令序列 → 执行结果'));
    header.appendChild(el('p', 'lede',
        '每个程序只编译一次：编译器（Init）把源码变成 VM 内存里的指令；' +
        '中间的指令列就是这份内存镜像（并与编译器反汇编输出逐单元格核对）；' +
        'VM 单步执行（Step）时，每一步按程序计数器 IP 到同一份清单里查出正在执行的指令。' +
        '所以「你看到的指令」和「最终输出」天然对得上——下面用校验结果证明这一点。'));
    root.appendChild(header);

    const summary = el('div', 'summary');
    root.appendChild(summary);

    let passed = 0;
    for (const program of PROGRAMS) {
        const { card, ok } = renderProgram(program);
        root.appendChild(card);
        if (ok) passed++;
    }

    summary.classList.add(passed === PROGRAMS.length ? 'summary-ok' : 'summary-fail');
    summary.textContent = passed === PROGRAMS.length
        ? `✓ ${passed}/${PROGRAMS.length} 个程序全部通过：展示的指令与执行的指令是同一份，最终输出与预期一致`
        : `✗ 仅 ${passed}/${PROGRAMS.length} 个程序通过校验`;
    root.insertBefore(summary, header.nextSibling);

    document.title = `MiniC 管线对照（${passed}/${PROGRAMS.length} 通过）`;
    window.__PIPELINE_DONE__ = { passed, total: PROGRAMS.length };
}

waitForVm(main);
