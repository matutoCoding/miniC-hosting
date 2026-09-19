(function () {
    'use strict'

    // ---- Blazor interop (same entry points the original UI uses) ----
    function invoke() {
        return DotNet.invokeMethod(...['Blazor2', ...arguments])
    }

    const $ = id => document.getElementById(id)
    const statusEl = $('status')
    const sourceEl = $('source')
    const presetEl = $('preset')
    const instrEl = $('instructions')
    const traceEl = $('trace')
    const regsEl = $('registers')
    const resultEl = $('result')
    const compileBtn = $('compileBtn')
    const stepBtn = $('stepBtn')
    const runBtn = $('runBtn')
    const resetBtn = $('resetBtn')

    // ---- demo programs (dialect: no for/++/globals; if/while/recursion ok) ----
    const presets = [
        {
            name: '1. 算术表达式（教程 Part 1）',
            expected: -399,
            code: `int main() {
    return 132 - 531;
}`
        },
        {
            name: '2. 运算符优先级（教程 Part 3）',
            expected: 8,
            code: `int main() {
    return 3 + 10 / 5 + 7 * 6 / 3 - 11;
}`
        },
        {
            name: '3. 变量与链式赋值（教程 Part 4）',
            expected: 5,
            code: `int main() {
    int a = 3;
    int b = a = 5;
    return b;
}`
        },
        {
            name: '4. while 循环：5+4+3+2+1',
            expected: 15,
            code: `int main() {
    int i = 5;
    int sum = 0;
    while (i > 0) {
        sum = sum + i;
        i = i - 1;
    }
    return sum;
}`
        },
        {
            name: '5. 函数调用：square(7) + 1',
            expected: 50,
            code: `int square(int x) {
    return x * x;
}

int main() {
    return square(7) + 1;
}`
        },
        {
            name: '6. 斐波那契（迭代，第 10 项）',
            expected: 55,
            code: `int main() {
    int a = 0;
    int b = 1;
    int i = 0;
    while (i < 10) {
        int t = a + b;
        a = b;
        b = t;
        i = i + 1;
    }
    return a;
}`
        }
    ]

    // ---- state ----
    let printedLines = []   // exact lines shown in pane 2, from PrintInstructions
    let lineEls = []
    let compiled = false
    let finished = false
    let stepCount = 0
    let mismatchCount = 0
    let lastNextLine = -1

    const opCodeToStringCache = {}
    function opCodeToString(value) {
        if (opCodeToStringCache[value] === undefined) {
            opCodeToStringCache[value] = invoke('OpCodeToString', Number(value))
        }
        return opCodeToStringCache[value]
    }

    function setStatus(msg, cls) {
        statusEl.textContent = msg
        statusEl.className = cls || ''
    }

    // find the displayed line that corresponds to instruction at `ip` with opcode `op`.
    // same matching rule as the original UI: a line starting with "<ip> <OP>"
    function findLine(ip, op) {
        const prefix = ip + ' ' + op
        for (let i = 0; i < printedLines.length; i++) {
            const t = printedLines[i].trim()
            if (t === prefix || t.indexOf(prefix + ' ') === 0) return i
        }
        return -1
    }

    function renderInstructions() {
        instrEl.innerHTML = ''
        instrEl.classList.remove('empty')
        lineEls = printedLines.map(text => {
            const div = document.createElement('div')
            div.className = 'line'
            div.textContent = text
            instrEl.appendChild(div)
            return div
        })
    }

    function renderRegisters() {
        regsEl.innerHTML =
            '<span><b>IP</b> ' + invoke('IP') + '</span>' +
            '<span><b>SP</b> ' + invoke('SP') + '</span>' +
            '<span><b>BP</b> ' + invoke('BP') + '</span>' +
            '<span><b>HP</b> ' + invoke('HP') + '</span>'
    }

    function clearMarks() {
        lineEls.forEach(el => el.classList.remove('done', 'next', 'mismatch'))
        lastNextLine = -1
    }

    function compile() {
        try {
            invoke('Init', sourceEl.value)
        } catch (error) {
            const end = error.message.indexOf('at Microsoft.JSInterop')
            resultEl.innerHTML = '<span class="err">编译错误：' +
                escapeHtml(error.message.substring(18, end > 0 ? end : undefined)) + '</span>'
            compiled = false
            updateButtons()
            return false
        }
        // The instruction text below is produced by the SAME VM state that Step() runs.
        const printed = invoke('PrintInstructions')
        printedLines = printed.split('\n').filter((l, i) => i > 0 && l.trim() !== '')
        renderInstructions()
        traceEl.textContent = ''
        traceEl.classList.add('empty')
        traceEl.textContent = '（执行轨迹：每一步先按 IP 从内存读出指令，执行后记录在此）'
        resultEl.textContent = ''
        stepCount = 0
        mismatchCount = 0
        finished = false
        compiled = true
        clearMarks()
        renderRegisters()
        updateButtons()
        return true
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    }

    function addTrace(html, cls) {
        if (stepCount === 0 && traceEl.classList.contains('empty')) {
            traceEl.textContent = ''
            traceEl.classList.remove('empty')
        }
        const div = document.createElement('div')
        if (cls) div.className = cls
        div.innerHTML = html
        traceEl.appendChild(div)
        traceEl.scrollTop = traceEl.scrollHeight
    }

    // Execute exactly one instruction: the one the VM holds at IP right now.
    // We read it from VM memory, match it against the displayed list, then Step().
    function stepOnce() {
        const ip = invoke('IP')
        const slice = invoke('MemorySlice', ip, 2)
        const op = opCodeToString(slice[0])
        const arg = slice[1]

        const lineIdx = findLine(ip, op)
        const shownText = lineIdx >= 0 ? printedLines[lineIdx].trim() : '(未在指令列表中找到!)'

        if (lastNextLine >= 0 && lineEls[lastNextLine]) {
            lineEls[lastNextLine].classList.remove('next')
            lineEls[lastNextLine].classList.add('done')
        }
        if (lineIdx >= 0) {
            lineEls[lineIdx].classList.add('next')
            lineEls[lineIdx].scrollIntoView({ block: 'nearest' })
        } else {
            mismatchCount++
        }
        lastNextLine = lineIdx

        stepCount++
        addTrace(
            '#' + stepCount + '  IP=' + ip + '  执行: ' + escapeHtml(shownText) +
            (lineIdx >= 0 ? '' : '  ⚠ 与显示列表不匹配'),
            lineIdx >= 0 ? 't-done' : 't-mismatch')

        const cont = invoke('Step')
        renderRegisters()
        if (!cont) {
            finished = true
            const ret = invoke('MemorySlice', invoke('SP'), 1)[0]
            resultEl.innerHTML = '<span class="ok">main() 返回 ' + ret + '</span>' +
                '（共执行 ' + stepCount + ' 条指令' +
                (mismatchCount ? '，<span class="err">' + mismatchCount + ' 条与显示不匹配</span>' : '，全部与中间一栏一致') + '）'
        }
        updateButtons()
        return cont
    }

    function runAll() {
        const cap = 100000
        let n = 0
        while (!finished && n < cap) { stepOnce(); n++ }
        if (n >= cap) resultEl.innerHTML = '<span class="err">超过步数上限，已停止</span>'
    }

    function updateButtons() {
        stepBtn.disabled = !compiled || finished
        runBtn.disabled = !compiled || finished
        resetBtn.disabled = !compiled
    }

    compileBtn.onclick = compile
    resetBtn.onclick = compile
    stepBtn.onclick = () => stepOnce()
    runBtn.onclick = runAll

    presets.forEach((p, i) => {
        const opt = document.createElement('option')
        opt.value = i
        opt.textContent = p.name
        presetEl.appendChild(opt)
    })
    presetEl.onchange = () => { sourceEl.value = presets[presetEl.value].code }
    sourceEl.value = presets[0].code

    // ---- boot: wait until the Blazor runtime is up (same trick as main.js) ----
    const interval = setInterval(() => {
        try {
            invoke('Init', 'int main(){return 2+2;}')
            clearInterval(interval)
            setStatus('沙盒就绪。编译后，中间一栏的指令序列就是虚拟机逐条执行的那一份。', 'ready')
            $('pipeline').hidden = false
            const auto = location.search.match(/auto=(\d+),(\d+)/)
            if (auto) {
                presetEl.value = auto[1]
                sourceEl.value = presets[auto[1]].code
                compile()
                for (let i = 0; i < Number(auto[2]) && !finished; i++) stepOnce()
            }
            if (location.search.indexOf('selftest') >= 0) selftest()
        } catch (error) {
            // blazor not initialized yet
        }
    }, 100)

    // ---- self test: compile + run every preset, dump JSON for headless checks ----
    function selftest() {
        const out = []
        presets.forEach(p => {
            sourceEl.value = p.code
            const ok = compile()
            const rec = { name: p.name, compiled: ok }
            if (ok) {
                runAll()
                rec.steps = stepCount
                rec.mismatches = mismatchCount
                rec.returned = invoke('MemorySlice', invoke('SP'), 1)[0]
                rec.expected = p.expected
                rec.pass = rec.returned === p.expected && rec.mismatches === 0
                rec.instructions = printedLines.map(l => l.trim())
            }
            out.push(rec)
        })
        const pre = $('selftest')
        pre.hidden = false
        pre.textContent = 'SELFTEST ' + JSON.stringify(out, null, 1)
        document.title = 'SELFTEST_DONE'
    }
})()
