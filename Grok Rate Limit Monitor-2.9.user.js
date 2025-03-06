// ==UserScript==
// @name         Grok Rate Limit Monitor
// @namespace    http://tampermonkey.net/
// @version      2.9
// @description  监控Grok的API使用限制和实时刷新倒计时
// @author       You
// @match        https://grok.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ===== 数据存储 =====
    const STORAGE_KEY = 'grok-monitor-data';
    let rateLimitData = {
        DEFAULT: null,
        REASONING: null,
        DEEPSEARCH: null
    };
    let isCollapsed = false;

    // 全局单一计时器
    let mainTimerInterval = null;

    // 倒计时结束时间戳
    let endTimestamps = {
        DEFAULT: 0,
        REASONING: 0,
        DEEPSEARCH: 0
    };

    // 查询类型的显示信息
    const queryTypeInfo = {
        DEFAULT: { name: '普通', color: '#4CAF50' },
        REASONING: { name: '思考', color: '#FFA500' },
        DEEPSEARCH: { name: '深度研究', color: '#9C27B0' }
    };

    // ===== 核心功能 =====

    // 重置所有数据
    function resetAllData() {
        // 停止主计时器
        stopMainTimer();

        // 重置时间戳
        Object.keys(endTimestamps).forEach(type => {
            endTimestamps[type] = 0;
        });

        // 重置数据
        rateLimitData = {
            DEFAULT: null,
            REASONING: null,
            DEEPSEARCH: null
        };
        localStorage.removeItem(STORAGE_KEY);
        console.log('Grok Monitor: 已重置所有数据');
    }

    // 加载保存的数据
    function loadSavedData() {
        try {
            const savedData = localStorage.getItem(STORAGE_KEY);
            if (savedData) {
                const data = JSON.parse(savedData);
                if (data.rateLimitData) {
                    // 兼容旧版数据格式
                    if (typeof data.rateLimitData === 'object' && !Array.isArray(data.rateLimitData)) {
                        if (data.rateLimitData.DEFAULT !== undefined ||
                            data.rateLimitData.REASONING !== undefined ||
                            data.rateLimitData.DEEPSEARCH !== undefined) {
                            rateLimitData = data.rateLimitData;
                        } else {
                            // 旧版数据结构，将其转换为新结构
                            rateLimitData.DEFAULT = data.rateLimitData;
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Grok Monitor: 无法加载保存的数据', e);
        }
    }

    // 保存数据到本地
    function saveData() {
        try {
            const dataToSave = {
                rateLimitData: {...rateLimitData}
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
        } catch (e) {
            console.error('Grok Monitor: 无法保存数据', e);
        }
    }

    // 监听聊天请求以捕获查询类型
    function setupRequestInterception() {
        // 拦截XMLHttpRequest
        const originalXHROpen = XMLHttpRequest.prototype.open;
        const originalXHRSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url) {
            this._url = url;
            this._method = method;
            return originalXHROpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function(body) {
            const xhr = this;

            // 保存请求中的查询类型，以便在响应中使用
            let requestQueryType = null;

            // 如果是请求体中包含requestKind，捕获对应查询类型
            if (body && typeof body === 'string') {
                try {
                    const data = JSON.parse(body);
                    if (data.requestKind && data.modelName === 'grok-3') {
                        if (rateLimitData.hasOwnProperty(data.requestKind)) {
                            requestQueryType = data.requestKind;
                            xhr._queryType = requestQueryType; // 将查询类型存储在xhr对象上
                            console.log('XHR捕获到查询类型:', requestQueryType);
                        }
                    }
                } catch (e) {
                    // 忽略非JSON数据
                }
            }

            // 捕获速率限制信息
            if (xhr._url && xhr._url.includes('/rest/rate-limits')) {
                const originalOnReadyStateChange = xhr.onreadystatechange;
                xhr.onreadystatechange = function() {
                    if (xhr.readyState === 4 && xhr.status === 200) {
                        try {
                            const response = JSON.parse(xhr.responseText);
                            if (isValidRateLimitData(response)) {
                                // 使用请求中保存的查询类型，如果存在的话
                                const queryType = xhr._queryType || 'DEFAULT';
                                updateRateLimitData(response, queryType);
                                console.log(`XHR响应更新了${queryTypeInfo[queryType].name}查询的速率限制数据`);
                            }
                        } catch (e) {}
                    }
                    if (originalOnReadyStateChange) {
                        originalOnReadyStateChange.apply(xhr, arguments);
                    }
                };
            }

            return originalXHRSend.apply(this, arguments);
        };

        // 拦截Fetch请求
        const originalFetch = window.fetch;
        window.fetch = function(url, options) {
            // 检查是否是我们的自定义请求
            const isCustomRateLimitRequest = options &&
                                            options.headers &&
                                            options.headers['X-Query-Type'];

            // 如果是我们的自定义请求，不进行拦截处理，直接使用原始fetch
            if (isCustomRateLimitRequest) {
                return originalFetch.apply(this, arguments);
            }

            // 从请求体中提取查询类型
            let requestQueryType = null;
            if (options && options.body && typeof options.body === 'string') {
                try {
                    const data = JSON.parse(options.body);
                    if (data.requestKind && data.modelName === 'grok-3') {
                        if (rateLimitData.hasOwnProperty(data.requestKind)) {
                            requestQueryType = data.requestKind;
                            console.log('Fetch捕获到查询类型:', requestQueryType);
                        }
                    }
                } catch (e) {
                    // 忽略非JSON数据
                }
            }

            const fetchPromise = originalFetch.apply(this, arguments);

            // 捕获速率限制信息
            const urlStr = url && url.toString ? url.toString() : '';
            if (urlStr.includes('/rest/rate-limits') && !isCustomRateLimitRequest) {
                fetchPromise.then(response => {
                    const clonedResponse = response.clone();
                    clonedResponse.json().then(data => {
                        if (isValidRateLimitData(data)) {
                            // 使用请求中提取的查询类型，如果存在的话
                            const queryType = requestQueryType || 'DEFAULT';
                            updateRateLimitData(data, queryType);
                            console.log(`Fetch响应更新了${queryTypeInfo[queryType].name}查询的速率限制数据`);
                        }
                    }).catch(() => {});
                }).catch(() => {});
            }

            return fetchPromise;
        };
    }

    // 验证速率限制数据有效性
    function isValidRateLimitData(data) {
        return data &&
               typeof data.windowSizeSeconds !== 'undefined' &&
               typeof data.remainingQueries !== 'undefined' &&
               typeof data.totalQueries !== 'undefined';
    }

    // 更新速率限制数据
    function updateRateLimitData(data, queryType) {
        // 确保queryType是有效的
        if (rateLimitData.hasOwnProperty(queryType)) {
            rateLimitData[queryType] = data;
            console.log(`已更新${queryTypeInfo[queryType].name}查询的速率限制数据`);

            // 如果有倒计时，设置结束时间戳
            if (data.waitTimeSeconds !== undefined && data.remainingQueries === 0) {
                // 计算结束时间戳
                const now = Date.now();
                endTimestamps[queryType] = now + (data.waitTimeSeconds * 1000);
                console.log(`设置${queryTypeInfo[queryType].name}查询的倒计时结束时间:`, new Date(endTimestamps[queryType]));

                // 确保主计时器在运行
                startMainTimer();
            } else if (data.remainingQueries > 0) {
                // 重置倒计时
                endTimestamps[queryType] = 0;
            }

            saveData();
            updateUIDisplay();
        }
    }

    // 启动主计时器
    function startMainTimer() {
        // 如果已有计时器在运行，不重复启动
        if (mainTimerInterval) return;

        console.log('启动主计时器');

        // 每秒更新一次所有倒计时显示
        mainTimerInterval = setInterval(() => {
            const now = Date.now();
            let anyActiveCountdown = false;

            // 遍历所有查询类型
            Object.keys(endTimestamps).forEach(type => {
                if (endTimestamps[type] > now) {
                    // 还有倒计时，更新显示
                    anyActiveCountdown = true;

                    // 计算剩余秒数
                    const remainingMillis = endTimestamps[type] - now;
                    const remainingSeconds = Math.ceil(remainingMillis / 1000);

                    // 直接更新DOM显示
                    updateCountdownElement(type, remainingSeconds);
                } else if (endTimestamps[type] > 0) {
                    // 倒计时刚刚结束
                    console.log(`${queryTypeInfo[type].name}查询的倒计时结束，重新获取数据`);
                    endTimestamps[type] = 0; // 重置状态

                    // 更新显示
                    updateCountdownElement(type, 0);

                    // 重新获取数据
                    fetchRateLimits(type);
                }
            });

            // 如果没有任何活动倒计时，停止主计时器
            if (!anyActiveCountdown) {
                stopMainTimer();
            }

        }, 1000);
    }

    // 停止主计时器
    function stopMainTimer() {
        if (mainTimerInterval) {
            console.log('停止主计时器');
            clearInterval(mainTimerInterval);
            mainTimerInterval = null;
        }
    }

    // 直接更新倒计时DOM元素
    function updateCountdownElement(queryType, seconds) {
        const countdownElement = document.getElementById(`grok-countdown-${queryType}`);
        if (countdownElement) {
            const formattedTime = formatCountdown(seconds);
            countdownElement.textContent = formattedTime;
        }
    }

    // 格式化秒数为时:分:秒
    function formatCountdown(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // 自动发送初始请求以获取各种类型的速率限制数据
    function sendInitialQueries() {
        // 按顺序依次发送请求，避免并发请求导致数据混淆
        fetchRateLimitsSequentially(['DEFAULT', 'REASONING', 'DEEPSEARCH']);
    }

    // 按顺序依次获取速率限制数据，避免并发请求导致的混淆
    async function fetchRateLimitsSequentially(queryTypes) {
        for (const type of queryTypes) {
            await fetchRateLimits(type);
            // 添加延迟，确保请求之间有足够的间隔
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // 获取特定类型的速率限制数据
    async function fetchRateLimits(queryType) {
        if (!queryTypeInfo[queryType]) return;

        console.log(`正在请求${queryTypeInfo[queryType].name}查询的速率限制数据...`);

        // 构建请求URL和请求体
        const url = 'https://grok.com/rest/rate-limits';
        const body = JSON.stringify({
            requestKind: queryType,
            modelName: 'grok-3'
        });

        try {
            // 使用自定义的fetch方法，避免被请求拦截器处理
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Query-Type': queryType // 添加自定义头，标识查询类型
                },
                body: body
            });

            const data = await response.json();

            if (isValidRateLimitData(data)) {
                // 手动直接更新对应类型的数据
                rateLimitData[queryType] = data;
                saveData();
                updateUIDisplay();
                console.log(`成功获取${queryTypeInfo[queryType].name}查询的速率限制数据`);
            }
        } catch (error) {
            console.error(`获取${queryTypeInfo[queryType].name}查询的速率限制数据失败:`, error);
        }

        return Promise.resolve(); // 确保可以在async/await链中使用
    }

    // ===== UI 相关功能 =====

    // 创建UI面板
    function createUIPanel() {
        // 主容器
        const panel = document.createElement('div');
        panel.id = 'grok-monitor-panel';
        applyStyles(panel, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '300px',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            color: '#333',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
            fontFamily: '"Segoe UI", Roboto, -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '14px',
            zIndex: '9999',
            overflow: 'hidden',
            border: '1px solid rgba(0, 0, 0, 0.05)'
        });

        // 标题栏
        const titleBar = document.createElement('div');
        titleBar.id = 'grok-monitor-titlebar';
        applyStyles(titleBar, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
            cursor: 'move'
        });

        // 标题和图标
        const titleText = document.createElement('div');
        titleText.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> <span style="margin-left: 6px; font-weight: 500; color: #333;">Grok 使用监控</span>';
        applyStyles(titleText, {
            display: 'flex',
            alignItems: 'center'
        });

        // 控制按钮
        const controls = document.createElement('div');
        controls.id = 'grok-monitor-controls';

        // 最小化按钮
        const collapseBtn = document.createElement('button');
        collapseBtn.id = 'grok-monitor-collapse';
        collapseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
        collapseBtn.title = '最小化';
        applyStyles(collapseBtn, {
            backgroundColor: 'transparent',
            border: 'none',
            color: '#777',
            marginRight: '8px',
            cursor: 'pointer',
            padding: '3px',
            borderRadius: '4px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center'
        });

        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.id = 'grok-monitor-close';
        closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        closeBtn.title = '关闭';
        applyStyles(closeBtn, {
            backgroundColor: 'transparent',
            border: 'none',
            color: '#777',
            cursor: 'pointer',
            padding: '3px',
            borderRadius: '4px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center'
        });

        controls.appendChild(collapseBtn);
        controls.appendChild(closeBtn);

        titleBar.appendChild(titleText);
        titleBar.appendChild(controls);

        // 内容区域
        const content = document.createElement('div');
        content.id = 'grok-monitor-content';
        applyStyles(content, {
            padding: '16px',
            fontSize: '13px',
            lineHeight: '1.5'
        });

        // 速率限制部分
        const limitSection = document.createElement('div');
        limitSection.id = 'grok-rate-limit-section';
        limitSection.innerHTML = `
            <div style="margin-bottom: 8px; font-weight: 500; color: #333;">API 使用限制</div>
            <div id="grok-rate-limit-data" style="color: #555; margin-bottom: 12px;">
                等待加载数据...
            </div>
        `;

        // 底部信息
        const footer = document.createElement('div');
        footer.id = 'grok-monitor-footer';
        applyStyles(footer, {
            borderTop: '1px solid rgba(0, 0, 0, 0.05)',
            paddingTop: '8px',
            marginTop: '4px',
            fontSize: '11px',
            color: '#999',
            textAlign: 'right'
        });
        footer.innerHTML = `<span id="grok-update-time"></span>`;

        content.appendChild(limitSection);
        content.appendChild(footer);

        panel.appendChild(titleBar);
        panel.appendChild(content);

        document.body.appendChild(panel);

        // 绑定事件
        collapseBtn.addEventListener('click', togglePanelCollapse);
        closeBtn.addEventListener('click', hidePanel);

        // 初始化拖拽功能
        makeDraggable(panel, titleBar);

        return panel;
    }

    // 更新UI显示
    function updateUIDisplay() {
        updateRateLimitDisplay();
        updateTimeDisplay();
    }

    // 更新速率限制显示
    function updateRateLimitDisplay() {
        const limitDataDiv = document.getElementById('grok-rate-limit-data');
        if (!limitDataDiv) return;

        // 检查是否有任何限制数据
        const hasAnyData = Object.values(rateLimitData).some(data => data !== null);

        if (!hasAnyData) {
            limitDataDiv.innerHTML = `<div style="color: #777; padding: 12px; text-align: center; background-color: #f9f9f9; border-radius: 8px;">等待获取数据...</div>`;
            return;
        }

        // 为每种有数据的查询类型创建一个显示部分
        let limitHtml = '';

        Object.entries(rateLimitData).forEach(([type, data]) => {
            if (!data) return;

            const info = queryTypeInfo[type];
            const windowSizeHours = data.windowSizeSeconds / 3600;
            const queriesUsed = data.totalQueries - data.remainingQueries;
            const remainingPercentage = Math.round((data.remainingQueries / data.totalQueries) * 100);

            // 确定进度条颜色 - 基于剩余量而非使用量
            let barColor = 'rgb(50, 150, 80)'; // 默认绿色
            let textColor = 'rgb(50, 150, 80)';
            if (remainingPercentage < 25) {
                barColor = 'rgb(220, 60, 60)'; // 红色
                textColor = 'rgb(220, 60, 60)';
            } else if (remainingPercentage < 50) {
                barColor = 'rgb(237, 171, 52)'; // 黄色
                textColor = 'rgb(237, 171, 52)';
            }

            // 处理刷新倒计时
            let refreshTimerHtml = '';
            const now = Date.now();

            if (endTimestamps[type] > now || (data.waitTimeSeconds !== undefined && data.remainingQueries === 0)) {
                // 计算初始显示时间
                let initialSeconds = 0;

                if (endTimestamps[type] > now) {
                    // 使用现有的结束时间戳计算剩余时间
                    initialSeconds = Math.ceil((endTimestamps[type] - now) / 1000);
                } else if (data.waitTimeSeconds) {
                    // 使用API返回的等待时间
                    initialSeconds = data.waitTimeSeconds;

                    // 顺便设置结束时间戳
                    endTimestamps[type] = now + (initialSeconds * 1000);

                    // 确保主计时器在运行
                    startMainTimer();
                }

                const formattedTime = formatCountdown(initialSeconds);

                refreshTimerHtml = `
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px; align-items: center;">
                        <div style="color: #555; font-size: 13px;">刷新倒计时:</div>
                        <div id="grok-countdown-${type}" style="color: rgb(220, 60, 60); font-weight: 500; background-color: rgba(220, 60, 60, 0.1); padding: 3px 8px; border-radius: 4px;">${formattedTime}</div>
                    </div>
                `;
            }

            limitHtml += `
                <div style="margin-bottom: 16px; border-radius: 10px; background-color: #f9f9f9; padding: 12px 14px;">
                    <div style="font-weight: 500; color: #333; margin-bottom: 10px; font-size: 14px; display: flex; align-items: center;">
                        <span style="display: inline-block; width: 8px; height: 8px; background-color: ${info.color}; border-radius: 50%; margin-right: 8px;"></span>
                        ${info.name}查询
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px; align-items: center;">
                        <div style="color: #555; font-size: 13px;">已用/总数:</div>
                        <div style="color: #333; font-weight: 500;">${queriesUsed} / ${data.totalQueries}</div>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px; align-items: center;">
                        <div style="color: #555; font-size: 13px;">剩余查询:</div>
                        <div style="color: ${textColor}; font-weight: 500; background-color: rgba(${textColor.replace('rgb(', '').replace(')', '')}, 0.1); padding: 3px 8px; border-radius: 4px;">${data.remainingQueries}</div>
                    </div>
                    ${refreshTimerHtml}
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px; align-items: center;">
                        <div style="color: #555; font-size: 13px;">重置周期:</div>
                        <div style="color: #333; font-weight: 500;">${windowSizeHours} 小时</div>
                    </div>
                    <div style="background-color: #eee; height: 6px; border-radius: 4px; overflow: hidden; margin: 10px 0;">
                        <div style="background-color: ${barColor}; width: ${remainingPercentage}%; height: 100%;"></div>
                    </div>
                    <div style="display: flex; justify-content: flex-end; font-size: 11px; color: #777; margin-top: 4px;">
                        ${remainingPercentage}% 剩余
                    </div>
                </div>
            `;
        });

        limitDataDiv.innerHTML = limitHtml || `<div style="color: #777; padding: 12px; text-align: center; background-color: #f9f9f9; border-radius: 8px;">等待获取数据...</div>`;
    }

    // 更新时间显示
    function updateTimeDisplay() {
        const timeSpan = document.getElementById('grok-update-time');
        if (timeSpan) {
            timeSpan.textContent = `更新于 ${new Date().toLocaleTimeString()}`;
        }
    }

    // 切换面板折叠状态
    function togglePanelCollapse() {
        const panel = document.getElementById('grok-monitor-panel');
        const content = document.getElementById('grok-monitor-content');
        const collapseBtn = document.getElementById('grok-monitor-collapse');

        if (!panel || !content || !collapseBtn) return;

        isCollapsed = !isCollapsed;

        if (isCollapsed) {
            content.style.display = 'none';
            collapseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
            collapseBtn.title = '展开';
            panel.style.width = 'auto';
        } else {
            content.style.display = 'block';
            collapseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
            collapseBtn.title = '最小化';
            panel.style.width = '300px';
            updateUIDisplay();
        }
    }

    // 隐藏面板
    function hidePanel() {
        const panel = document.getElementById('grok-monitor-panel');
        if (panel) {
            panel.style.display = 'none';
        }

        // 创建一个重新显示的按钮
        if (!document.getElementById('grok-show-monitor')) {
            const showBtn = document.createElement('button');
            showBtn.id = 'grok-show-monitor';
            showBtn.textContent = '显示监控';
            applyStyles(showBtn, {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                backgroundColor: '#ffffff',
                color: '#333',
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: '8px',
                padding: '8px 12px',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                zIndex: '9998',
                fontFamily: '"Segoe UI", Roboto, -apple-system, BlinkMacSystemFont, sans-serif',
                fontSize: '12px',
                fontWeight: '500'
            });

            // 添加悬停效果
            showBtn.addEventListener('mouseover', function() {
                this.style.backgroundColor = '#f5f5f5';
            });

            showBtn.addEventListener('mouseout', function() {
                this.style.backgroundColor = '#ffffff';
            });

            showBtn.addEventListener('click', showPanel);
            document.body.appendChild(showBtn);
        }
    }

    // 显示面板
    function showPanel() {
        const panel = document.getElementById('grok-monitor-panel');
        if (panel) {
            panel.style.display = 'block';

            // 如果之前是折叠状态，更新显示
            if (!isCollapsed) {
                updateUIDisplay();
            }
        }

        // 移除显示按钮
        const showBtn = document.getElementById('grok-show-monitor');
        if (showBtn) {
            showBtn.remove();
        }
    }

    // 完全重写的拖拽功能
    function makeDraggable(element, handle) {
        if (!element || !handle) return;

        let isDragging = false;
        let startX, startY;
        let elementX, elementY;

        // 初始化面板位置为绝对坐标
        function initializePosition() {
            const rect = element.getBoundingClientRect();

            // 记住原来显示的位置
            elementX = rect.left;
            elementY = rect.top;

            // 设置为绝对定位
            element.style.position = 'fixed';
            element.style.top = elementY + 'px';
            element.style.left = elementX + 'px';
            element.style.bottom = 'auto';
            element.style.right = 'auto';

            // 重要：移除所有过渡效果，让拖拽更流畅
            element.style.transition = 'none';
        }

        function onMouseDown(e) {
            // 阻止默认行为和冒泡
            e.preventDefault();
            e.stopPropagation();

            // 初始化位置
            initializePosition();

            // 记住鼠标起始位置
            startX = e.clientX;
            startY = e.clientY;

            // 设置为正在拖拽
            isDragging = true;

            // 添加事件监听
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            // 阻止文本选择
            document.body.style.userSelect = 'none';
        }

        function onMouseMove(e) {
            if (!isDragging) return;

            // 计算鼠标移动的距离
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            // 更新元素位置（直接跟随鼠标）
            element.style.left = (elementX + deltaX) + 'px';
            element.style.top = (elementY + deltaY) + 'px';
        }

        function onMouseUp(e) {
            if (!isDragging) return;

            // 停止拖拽
            isDragging = false;

            // 更新元素的最终位置
            elementX = parseInt(element.style.left);
            elementY = parseInt(element.style.top);

            // 移除事件监听
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            // 恢复文本选择
            document.body.style.userSelect = '';
        }

        // 绑定鼠标按下事件
        handle.addEventListener('mousedown', onMouseDown);
    }

    // 设置自动定时保存
    function setupAutoSave() {
        // 每30秒保存一次
        setInterval(saveData, 30 * 1000);

        // 页面卸载前保存
        window.addEventListener('beforeunload', saveData);
    }

    // 应用样式到元素
    function applyStyles(element, styles) {
        for (const [property, value] of Object.entries(styles)) {
            element.style[property] = value;
        }
    }

    // 初始化
    function initialize() {
        // 先清空之前保存的信息
        resetAllData();

        // 创建UI
        createUIPanel();

        // 设置请求拦截
        setupRequestInterception();

        // 启动自动保存
        setupAutoSave();

        // 初始显示
        updateUIDisplay();

        // 发送初始请求获取速率限制数据
        setTimeout(() => {
            sendInitialQueries();
        }, 2000); // 延迟2秒，确保页面已完全加载

        console.log('Grok监控已初始化');
    }

    // 当DOM加载完成后初始化
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();