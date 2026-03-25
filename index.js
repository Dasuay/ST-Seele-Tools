import { getFirstDisplayedMessageId, showMoreMessages, messageEdit } from '/script.js';
import { getContext as ctx } from '/scripts/st-context.js';
import { delay } from '/scripts/utils.js';
import { oai_settings } from '/scripts/openai.js';

const MODULE_NAME = 'seele_tools';
let nowCard = null;

// 全局数据管理
const dataManager = (() => {
    const initExt = Object.freeze({
        fastOpen: true,
        autoJump: true,
        outSave: false,
        blackTags: "",
        whiteTags: "",
        regexIds: "",
    });
    const initChat = Object.freeze({
        bookMarks: "",
        expSender: false,
        expMesId: false,
        expUser: false,
        expClean: false,
        expNovel: false,
        expReplace: true
    });
    function getConf(init, conf) {
        const current = conf[MODULE_NAME] || {};
        conf[MODULE_NAME] = Object.fromEntries(
            Object.keys(init).map(k => [k, Object.hasOwnProperty.call(current, k) ? current[k] : init[k]])
        );
        return conf[MODULE_NAME];
    }
    return {
        get extConf() { return getConf(initExt, ctx().extensionSettings) },
        get chatConf() { return getConf(initChat, ctx().chatMetadata) },
        extSave: () => ctx().saveSettingsDebounced(),
        chatSave: () => ctx().saveChat()
    };
})();

// 全局事件管理
const eventManager = (() => {
    const eventList = [];
    function register(method, eventName, listener) {
        ctx().eventSource[method](eventName, listener);
        const record = { eventName, listener };
        eventList.push(record);
        return { stop: () => {
            ctx().eventSource.removeListener(eventName, listener);
            const index = eventList.indexOf(record);
            if (index > -1) eventList.splice(index, 1);
        }};
    }
    function unregister(eventName, listener) {
        ctx().eventSource.removeListener(eventName, listener);
        const index = eventList.findIndex(r => r.eventName === eventName && r.listener === listener);
        if (index > -1) eventList.splice(index, 1);
    }
    return {
        on: (eventName, listener) => register('on', eventName, listener),
        makeLast: (eventName, listener) => register('makeLast', eventName, listener),
        remove: (eventName, listener) => unregister(eventName, listener),
        removeAll: () => { while (eventList.length > 0) { const { eventName, listener } = eventList[0]; unregister(eventName, listener) } },
    };
})();

function openMenu(e) {
    if ($('#seele-menu').length) return;
    const $editer = $('#curEditTextarea');
    const extConf = dataManager.extConf;
    const chatConf = dataManager.chatConf;
    const maxMesId = ctx().substituteParamsExtended('{{lastMessageId}}');
    const expName = `${ctx().characters[ctx().characterId]?.name ?? 'Chat_Export'} - ${new Date().toLocaleDateString('sv')} #${maxMesId}`;

    let nowMesId = null;
    if ($editer.length) {
        nowMesId = $editer.closest('.mes').attr('mesid');
    } else {
        if (e && e.currentTarget) {
            nowCard = e.currentTarget;
        } else {
            const $chat = $('#chat');
            const chatTop = $chat.scrollTop() + 50;
            const chatBottom = chatTop + $chat.height();
            nowCard = $chat.find('.mes').get().find(el => {
                const eTop = el.offsetTop;
                const eBottom = eTop + el.offsetHeight;
                return eTop < chatBottom && eBottom > chatTop;
            });
        }
        nowMesId = $(nowCard).attr('mesid');
    }

    const $wrapper = $(`
        <div id="seele-menu">
            <div class="header-group">
                <div class="header-row">
                    <div class="header-title"><i class="fa-solid fa-seedling"></i> 希儿工具箱</div>
                    <div class="header-tip">最大楼层: #${maxMesId}</div>
                </div>
                <div class="header-tabs">
                    <div class="tab-header active" data-tab="tab-nav">快捷导航</div>
                    <div class="tab-header" data-tab="tab-exp">导出聊天</div>
                    <div class="tab-header" data-tab="tab-set">功能配置</div>
                </div>
            </div>
            <div class="scroll-content">
                <!-- TAB 0: 快捷导航 -->
                <div class="tab-content active" id="tab-nav">
                    <div class="input-group">
                        <div class="label-row">
                            <span class="label-title">${$editer.length ? '编辑框操作' : `楼层操作`}</span>
                            <span class="label-desc">当前: #${nowMesId}</span>
                        </div>
                        <div class="input-wrapper">
                            <div class="btn-gap ${$editer.length ? 'succ' : 'warn'}" id="nowEdit"><i class="fa-solid ${$editer.length ? 'fa-save"></i>保存编辑' : 'fa-pencil"></i>编辑楼层'}</div>
                            ${$editer.length ? 
                                `<div class="btn-gap error" id="nowDel"><i class="fa-solid fa-trash-can"></i><span>从此删除</span></div>` :
                                `${((marked) => {
                                    return `<div class="btn-gap ${marked ? `error ${ctx().isMobile() ? 'active' : ''}` : 'succ'}" id="nowMark"><i class="fa-solid fa-bookmark"></i><span>${marked ? '删除' : '添加'}书签</span></div>`
                                })(chatConf.bookMarks.includes(nowMesId))}`
                            }
                            <div class="btn-gap" id="nowTop"><i class="fa-solid fa-arrow-up"></i>回到顶部</div>
                            <div class="btn-gap" id="nowBottom"><i class="fa-solid fa-arrow-down"></i>回到底部</div>
                        </div>
                    </div>
                    <div class="input-divider"></div>
                    <div class="input-group">
                        <div class="label-row">
                            <span class="label-title">楼层搜索</span>
                        </div>
                        <div class="input-wrapper">
                            <input type="text" class="text-input" id="chatContent" placeholder="输入关键字或#楼层ID...">
                            <div class="btn-icon succ" id="chatMark" title="加载书签"><i class="fa-solid fa-bookmark"></i></div>
                            <div class="btn-icon" id="chatSearch" title="搜索"><i class="fa-solid fa-search"></i></div>
                        </div>
                        <div class="input-wrapper">
                            <div class="input-search" id="chatArea"></div>
                        </div>
                    </div>
                </div>

                <!-- TAB 1: 导出聊天 -->
                <div class="tab-content" id="tab-exp">
                    <div class="input-group">
                        <div class="label-row"><span class="label-title">导出文件名</span></div>
                        <div class="input-wrapper">
                            <input type="text" class="text-input" id="expName" value="${expName}" placeholder="${expName}">
                            <select class="select-input" id="expType" style="max-width:15%">
                                <option value="txt">TXT</option>
                                <option value="jsonl">JSONL</option>
                            </select>
                        </div>
                    </div>
                    <div class="input-divider"></div>
                    <div class="input-group">
                        <div class="label-row"><span class="label-title">导出范围</span><label class="label-desc">留空则导出全部</label></div>
                        <div class="input-wrapper">
                            <input type="number" class="text-input" id="rangeMin" min="0" max="${maxMesId}" step="1" placeholder="起始(默认0)">
                            <span style="opacity:0.5">-</span>
                            <input type="number" class="text-input" id="rangeMax" min="0" max="${maxMesId}" step="1" placeholder="结束(默认${maxMesId || 0})">
                            <div class="btn-icon succ" id="rangeAdd"><i class="fa-solid fa-plus"></i></div>
                        </div>
                        <div class="input-wrapper">
                            <div><div class="scan-area" id="rangeArea"></div></div>
                        </div>
                    </div>
                    <div class="input-divider"></div>
                    <div class="input-group">
                        <div class="label-row"><span class="label-title">导出选项</span></div>
                        <div class="input-options" id="expOptions">
                            <label class="checkbox-label"><input type="checkbox" id="expSender" ${chatConf.expSender ? 'checked' : ''}> 显示发送者</label>
                            <label class="checkbox-label"><input type="checkbox" id="expMesId" ${chatConf.expMesId ? 'checked' : ''}> 显示楼层号</label>
                            <label class="checkbox-label"><input type="checkbox" id="expUser" ${chatConf.expUser ? 'checked' : ''}> 包含用户发言</label>
                            <label class="checkbox-label"><input type="checkbox" id="expClean" ${chatConf.expClean ? 'checked' : ''}> 去除代码段</label>
                            <label class="checkbox-label"><input type="checkbox" id="expNovel" title="以用户对话拆分为小说章节" ${chatConf.expNovel ? 'checked' : ''}> 小说章节拆分</label>
                            <label class="checkbox-label"><input type="checkbox" id="expReplace" title="应用功能配置中的\"标签筛选\"和\"酒馆正则\"" ${chatConf.expReplace ? 'checked' : ''}> 标签及正则替换</label>
                        </div>
                        <div id="jsonlTip" style="display:none;padding:10px;font-size:0.8em;opacity:0.6">
                            <i class="fa-solid fa-info-circle"></i> 导出无损 JSONL 数据文件<br>
                            <span style="font-size:0.9em">用于创建剧情分支或备份迁移数据</span>
                        </div>
                    </div>
                    <button class="btn-line succ" id="export"><i class="fa-solid fa-file-export"></i> 导出聊天数据</button>
                    <button class="btn-line warn" id="import" style="display:none"><i class="fa-solid fa-file-import"></i> 导入聊天数据</button>
                    <input type="file" id="import-file" style="display:none" accept="jsonl">
                </div>

                <!-- TAB 2: 功能配置 -->
                <div class="tab-content" id="tab-set">
                    <div class="input-group">
                        <div class="label-row"><span class="label-title">基础配置</span></div>
                        <div class="input-options optlist">
                            <label class="checkbox-label"><input type="checkbox" id="fastOpen" ${extConf.fastOpen ? 'checked' : ''}> 双击聊天栏启动菜单</label>
                            <label class="checkbox-label"><input type="checkbox" id="autoJump" ${extConf.autoJump ? 'checked' : ''}> 自动跳转至最新回复</label>
                            <label class="checkbox-label"><input type="checkbox" id="outSave" ${extConf.outSave ? 'checked' : ''}> 点击编辑框外部保存</label>
                        </div>
                    </div>
                    <div class="input-divider"></div>
                    <div class="input-group">
                        <div class="label-row">
                            <span class="label-title">标签筛选</span><label class="label-desc">按顺序匹配标签</label>
                        </div>
                        <div class="input-wrapper">
                            <label class="checkbox-label" style="cursor:auto">黑名单：</label>
                            <input type="text" class="text-input" id="blackTags" value="${extConf.blackTags}" placeholder="如: think, finish">
                            <div class="clearTag btn-icon error" title="清空黑名单"><i class="fa-solid fa-trash-can"></i></div>
                        </div>
                        <div class="input-wrapper">
                            <label class="checkbox-label" style="cursor:auto">白名单：</label>
                            <input type="text" class="text-input" id="whiteTags" value="${extConf.whiteTags}" placeholder="如: content, detail">
                            <div class="clearTag btn-icon error" title="清空白名单"><i class="fa-solid fa-trash-can"></i></div>
                        </div>
                        <div class="input-wrapper">
                            <div id="tagArea" style="width:100%"><span style="font-size:0.8em;opacity:0.5">未扫描聊天标签...</span></div>
                            <div class="btn-icon" id="searchTag" title="扫描当前聊天标签"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
                            <div class="btn-icon error" id="chgTagList" title="切换插入列表"><i class="fa-solid fa-not-equal"></i></div>
                        </div>
                    </div>
                    <div class="input-divider"></div>
                    <div class="input-group">
                        <div class="label-row">
                            <span class="label-title">酒馆正则</span><label class="label-desc">仅按顺序替换正则</label>
                        </div>
                        <div class="input-options optlist" id="regexArea" style="max-height:116px;overflow-y:auto">
                            ${Array.from(getRegexs().entries()).map(([id, rule]) => `
                                <label class="checkbox-label" title="${rule.find}"><input type="checkbox" value="${id}" ${extConf.regexIds.includes(id) ? 'checked' : ''}> ${rule.name}</label>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);
    bindMenuEvent($wrapper);
    ctx().callGenericPopup($wrapper, 1, "", { okButton: "关闭" });
}

function bindMenuEvent($wrapper) {
    // 基础绑定逻辑
    $wrapper.find('.tab-header').on('click', function() {
        $wrapper.find('.tab-header').removeClass('active'); $(this).addClass('active');
        $wrapper.find('.tab-content').removeClass('active'); $wrapper.find('#' + $(this).data('tab')).addClass('active');
    });
    const closePopup = () => {
        $wrapper.closest('dialog').remove();
    };
    const $editer = $('#curEditTextarea');
    const nowMesId = $editer.length ? $editer.closest('.mes').attr('mesid') : $(nowCard).attr('mesid');
    const maxMesId = ctx().substituteParamsExtended('{{lastMessageId}}');

    // 快捷导航
    const $tab_nav = $wrapper.find('#tab-nav');
    $tab_nav.on('click', '#nowEdit', function() {
        closePopup();
        if ($editer.length) {
            $editer.closest('.mes').find('.mes_edit_done').trigger('click');
        } else {
            messageEdit(nowMesId);
        }
    });

    $tab_nav.on('click', '#nowDel', function() {
        if ($(this).hasClass('sure')) {
            closePopup();
            $editer.closest('.mes').find('.mes_edit_done').trigger('click');
            for (let id = maxMesId; id >= nowMesId; id--) ctx().deleteMessage(id, null, false);
            toastr.success(`已删除 ${maxMesId - nowMesId + 1} 条消息`);
            dataManager.chatSave();
        } else {
            $(this).addClass('sure').find('span').html(`#${nowMesId}-${maxMesId}`);
            setTimeout(() => { $(this).removeClass('sure').find('span').html("从此删除") }, 3000);
        }
    });

    $tab_nav.on('click', '#nowMark', function() {
        const marked = $(this).hasClass('error');
        $(this).toggleClass('succ error');
        $(this).find('span').html(marked ? '添加书签' : '删除书签');
        if (ctx().isMobile()) $(this).toggleClass('active');
        updateBookmark(nowMesId);
    });

    $tab_nav.on('click', '#nowTop', function() {
        closePopup();
        if ($editer.length) {
            $editer.animate({ scrollTop: 0 });
        } else {
            nowCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });

    $tab_nav.on('click', '#nowBottom', function() {
        closePopup();
        if ($editer.length) {
            $editer.animate({ scrollTop: $editer.prop('scrollHeight') });
        } else {
            nowCard.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    });

    function doChatSearch() {
        const $area = $wrapper.find('#chatArea');
        $area.html('<div style="padding-bottom:10px;font-size:0.7em;opacity:0.6"><i class="fa-solid fa-spinner fa-spin"></i> 搜索中...</div>');
        if ($area.data('searchTimer')) clearTimeout($area.data('searchTimer'));
        $area.data('searchTimer', setTimeout(() => {
            let chat_list = getChats();
            let mark_set = new Set(dataManager.chatConf.bookMarks.split(',').filter(t => t.trim()));
            if ($tab_nav.find('#chatMark').hasClass('active')) {
                chat_list = chat_list.filter(item => mark_set.has(String(item.id)));
            }

            let keyword = $tab_nav.find('#chatContent').val().trim().toLowerCase();
            if (keyword) {
                chat_list = chat_list.filter(item => {
                    const idMatch = keyword.startsWith('#') && String(item.id).startsWith(keyword.substring(1));
                    const mesMatch = item.mes.toLowerCase().includes(keyword);
                    return idMatch || mesMatch;
                });
            }

            chat_list.forEach(chat => {
                const idx = keyword ? chat.mes.toLowerCase().indexOf(keyword) : -1;
                if (idx < 0) { chat.mes = _.escape(chat.mes.slice(0, 60)); return }
                const start = Math.max(0, idx - 10);
                const end = Math.max(idx + keyword.length, start + 60);
                let mes = chat.mes.slice(start, end);
                if (start > 0) mes = '...' + mes;
                chat.mes = _.escape(mes).replace(
                    new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                    match => `<span style="color:#b85b5b">${match}</span>`
                );
            });

            if (!chat_list.length) {
                $area.html(`<div style="padding-bottom:10px;font-size:0.7em;opacity:0.6">未找到匹配内容</div>`);
            } else {
                const $start = $(`<div style="padding-bottom:10px;font-size:0.7em;opacity:0.6;cursor:pointer">找到 ${chat_list.length} 条结果（单击跳转，双击书签）</div>`);
                $start.on('click', () => { $area.empty() });
                $area.html($start);
                chat_list.forEach(chat => {
                    const $item = $(`
                        <div class="search-item">
                            <div class="item-header"><span>${chat.name}</span>
                                <span>#${chat.id} <i class="fa-solid fa-bookmark" style="${mark_set.has(String(chat.id)) ? '' : 'display:none'}"></i></span>
                            </div>
                            <div class="item-content">${chat.mes}</div>
                        </div>
                    `);
                    $item.on('click', (e) => {
                        e.preventDefault();
                        const $this = $(e.currentTarget);
                        e.preventDefault();
                        if (e.detail == 1) {
                            $this.data('markTimer', setTimeout(() => {
                                closePopup(); jumpToMsg(String(chat.id));
                            }, 250));
                        } else {
                            if ($this.data('markTimer')) clearTimeout($this.data('markTimer'));                            
                            if (String(chat.id) == nowMesId && $tab_nav.find('#nowMark').length) {
                                $tab_nav.find('#nowMark').trigger('click');
                            } else {
                                updateBookmark(String(chat.id));
                            }
                            $this.find('i').toggle();
                        }
                    });
                    $area.append($item);
                });
                const $end = $(`<div style="padding-top:10px;font-size:0.7em;opacity:0.6;cursor:pointer">关闭搜索结果</div>`);
                $end.on('click', () => { $area.empty() });
                $area.append($end);
            }
        }, 500));
    }

    $tab_nav.on('keydown', '#chatContent', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); doChatSearch() }
    });
    $tab_nav.on('click', '#chatSearch', doChatSearch);
    $tab_nav.on('click', '#chatMark', function() { $(this).toggleClass('active') });
      
    // 导出聊天
    const $tab_exp = $wrapper.find('#tab-exp');
    $tab_exp.on('click', '#rangeAdd', function() {
        const $area = $wrapper.find('#rangeArea');
        let max = Number($tab_exp.find('#rangeMax').val()) || Number(maxMesId) || 0;
        let min = Number($tab_exp.find('#rangeMin').val()) || 0;
        max = Math.min(Math.max(max, 0), Number(maxMesId) || 0);
        min = Math.min(Math.max(min, 0), max);
        $tab_exp.find('#rangeMax, #rangeMin').val('');
        const $chip = $(`<div class="chip"><span>${_.escape(`[ ${min} - ${max} ]`)}</span></div>`);
        $chip.on('click', function() { $(this).remove() });
        $area.append($chip);
    });

    $tab_exp.on('change', '#expType', function() {
        if ($(this).val() == 'jsonl') {
            $tab_exp.find('#expOptions').hide();
            $tab_exp.find('#jsonlTip, #import').show();
        } else {
            $tab_exp.find('#expOptions').show();
            $tab_exp.find('#jsonlTip, #import').hide();
        }
    });

    function chatChange(event) {
        const $target = $(event.target);
        const field = $target.attr('id');
        const value = $target.is(':checkbox') ? $target.prop('checked') : $target.val();
        dataManager.chatConf[field] = value;
        dataManager.chatSave();
    }
    $tab_exp.on('change', '#expSender, #expMesId, #expUser, #expClean, expNovel, #expReplace', chatChange);

    $tab_exp.on('click', '#export', function() {
        let expName = $tab_exp.find('#expName').val().trim();
        const expType = $tab_exp.find('#expType').val();
        const rangeArea = $tab_exp.find('#rangeArea');
        
        if (!expName) expName = $tab_exp.find('#expName').attr('placeholder').trim();
        const range = new Set();
        rangeArea.children().each(function() {
            const match = $(this).text().match(/(\d+)\s*-\s*(\d+)/);
            for (let i = Number(match[1]); i <= Number(match[2]); i++) range.add(i);
        })
        if (range.size == 0) for (let i = 0; i <= Number(maxMesId) || 0; i++) range.add(i);

        // 导出JSONL数据文件
        if (expType == 'jsonl') {
            const lines = [JSON.stringify({
                user_name: ctx().name1 || "User",
                character_name: ctx().name2 || "Character",
                create_date: Date.now(),
                chat_metadata: (({ seele_tools, ...res }) => res)(ctx().chatMetadata || {})
            })];
            ctx().chat.forEach((msg, index) => {
                if (!range.has(index)) return;
                lines.push(JSON.stringify(msg));
            });
            if (exportFile(lines.join('\n'), `${expName}.jsonl`, 'application/json')) return toastr.success(`已导出 ${lines.length - 1} 条聊天数据`);
            return toastr.error(`导出聊天数据失败`);
        }

        const expSender = $tab_exp.find('#expSender').prop('checked');
        const expMesId = $tab_exp.find('#expMesId').prop('checked');
        const expUser = $tab_exp.find('#expUser').prop('checked');
        const expClean = $tab_exp.find('#expClean').prop('checked');
        const expNovel = $tab_exp.find('#expNovel').prop('checked');
        const expReplace = $tab_exp.find('#expReplace').prop('checked');

        let expText = "", novelIndex = 1, lastId = 0;
        const chat_list = getChats(expReplace).filter(chat => range.has(chat.id) && (expUser || !chat.is_user || chat.id == 0));
        chat_list.forEach(chat => {
            let mes = chat.mes, start = "", lines = [], end = "\n\n";
            if (expNovel) {
                // 当前为用户对话，或对话不连续时，开启新章节
                if (chat.is_user || lastId + 1 != chat.id) start = `第 ${novelIndex++} 章\n\n`;
                lastId = chat.id;
            } else {
                end += "--------------------\n\n";
            }
            // 构建消息头
            if (expSender || expMesId) {
                lines.push(`【 ${ expMesId ? `#${chat.id} ` : ""}${ expSender ? `${chat.name} ` : ""}】\n`);
            } else if (expNovel && chat.is_user){
                mes = `【${mes}】`;
            }
            // 构建消息内容
            if (expType == 'txt') {
                // 消除HTML标签
                if (expClean) {
                    const txt = document.createElement("textarea");
                    txt.innerHTML = mes
                        .replace(/<!--[\s\S]*?-->/g, '')
                        .replace(/<(br|p|div)[^>]*>/gi, '\n')
                        .replace(/<[^>]+>/g, '');
                    mes = txt.value;
                }
                lines.push(mes.trim());
            } 
            expText += start + lines.join('\n') + end;
        });

        if (expType == 'txt') {
            if (exportFile(expText, `${expName}.txt`, 'text/plain')) return toastr.success(`已导出 ${chat_list.length} 条聊天内容`);
        }
        return toastr.error(`导出聊天内容失败`);
    });

    $tab_exp.find('#import').on('click', () => $tab_exp.find('#import-file').click());
    $tab_exp.find('#import-file').on('change', function() {
        const file = this.files[0];
        if (!file || !file.name.toLowerCase().endsWith('.jsonl')) { this.value = ''; return toastr.error(`导入失败: 非 JSONL 文件`); }
        const $import = $tab_exp.find('#import'); const importText = $import.html();
        $import.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 正在处理...');
        setTimeout(() => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const content = e.target.result.trim();
                const first = JSON.parse(content.split('\n').filter(l => l.trim())[0]);
                if (first?.character_name != ctx()?.name2) return toastr.error(`导入失败: 非该角色卡记录`);
                try {
                    const form_data = new FormData();
                    form_data.append('avatar', new File([content], `imported.jsonl`, { type: 'application/json' }));
                    form_data.append('file_type', 'jsonl');
                    form_data.append('avatar_url', ctx().characters[ctx().characterId].avatar);
                    form_data.append('character_name', ctx().characters[ctx().characterId].name);
                    form_data.append('user_name', ctx().name1);
                    const headers = ctx().getRequestHeaders(); _.unset(headers, 'Content-Type');
                    fetch(`/api/chats/import`, {method: 'POST', headers: headers, body: form_data, cache: 'no-cache'});
                    return toastr.success(`导入成功`);
                } catch (error) { return toastr.error(`导入失败: 未获取到角色卡信息`); }
            };
            reader.readAsText(file, 'utf-8');
            $import.prop('disabled', false).html(importText); $(this).val('');
        }, 250);
    });

    // 功能配置
    const $tab_set = $wrapper.find('#tab-set');
    const extFuncMap = {
        fastOpen: updateFastOpen,
        autoJump: updateAutoJump,
        outSave: updateOutSave,
    };
    function extChange(event) {
        const $target = $(event.target);
        const field = $target.attr('id');
        const value = $target.is(':checkbox') ? $target.prop('checked') : $target.val();
        dataManager.extConf[field] = value;
        if (typeof extFuncMap[field] === 'function') extFuncMap[field]();
        dataManager.extSave();
    }
    $tab_set.on('change', '#fastOpen, #autoJump, #outSave', extChange);
    $tab_set.on('input', '#blackTags, #whiteTags', extChange);

    $tab_set.on('click', '#searchTag', function() {
        const $area = $wrapper.find('#tagArea');
        $area.html('<div style="padding:5px 10px;font-size:0.7em;opacity:0.6"><i class="fa-solid fa-spinner fa-spin"></i> 检测中...</div>');
        if ($area.data('searchTimer')) clearTimeout($area.data('searchTimer'));
        $area.data('searchTimer', setTimeout(() => {
            const tags = new Set();
            const htmlTags = new Set(['br', 'img', 'p', 'div', 'span', 'audio', 'video', 'strong', 'em', 'u', 's', 'code', 'pre', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'input', 'button', 'script', 'style', 'link', 'meta', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'b', 'i', 'font', 'center', 'strike']);
            const promptKeywords = ['rule', 'setting', 'engine', 'directive', 'logic', 'flow', 'diary', 'table', 'status', 'item', 'phase', 'abstract', 'digest', 'simile', 'metaphor', 'guidance', 'disclaimer', 'updatevariable', 'getvariable'];
            ctx().chat.forEach(msg => {
                const matches = msg.mes?.matchAll(/<([a-zA-Z0-9_\-\.]+)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g);
                if (!matches) return;
                for (const m of matches) {
                    const t = m[1]; const tLower = t.toLowerCase();
                    if (htmlTags.has(tLower) || promptKeywords.some(pk => tLower.includes(pk))) return;
                    tags.add(t);
                };
            });

            if (tags.size === 0) {
                $area.html('<span style="font-size:0.7em;opacity:0.6">未检测到成对的标签！</span>');
            } else {
                const $scan = $('<div class="scan-area"></div>');
                tags.forEach(tag => {
                    const $chip = $(`<div class="chip"><span>${_.escape(tag)}</span></div>`);
                    $chip.on('click', () => {
                        let $input = $wrapper.find('#blackTags');
                        if ($wrapper.find("#chgTagList").hasClass("succ")) $input = $wrapper.find('#whiteTags');
                        let val = $input.val().trim();
                        if (!val.includes(tag)) $input.val(val ? val + ", " + tag : tag);
                        $input.trigger('input');
                    });
                    $scan.append($chip);
                });
                $area.html($scan);
            }
        }, 500));
    });

    $tab_set.on('click', '#chgTagList', function() {
        if ($(this).data('tagTimer')) clearTimeout($(this).data('tagTimer'));
        $(this).addClass('active').toggleClass('succ error');
        $(this).find('i').toggleClass('fa-equals fa-not-equal');
        $(this).data('tagTimer', setTimeout(() => { $(this).removeClass('active') }, 3000));
    });

    $tab_set.on('click', '.clearTag', function() {
        const $input = $(this).siblings('input[type="text"]');
        $input.val('').trigger('input');
        dataManager.extSave();
    });

    $tab_set.on('change', '#regexArea input[type="checkbox"]', function() {
        const regexList = $wrapper.find('#regexArea input[type="checkbox"]:checked').map((i, el) => el.value).get();
        dataManager.extConf.regexIds = regexList.join(',');
        dataManager.extSave();
    });
}

// 添加菜单按钮
function addMenuButton() {
    if ($('#seele_tools_button').length) return;
    let $extensionsMenu = $('#extensionsMenu');
    if (!$extensionsMenu.length) {
        const optionsMenu = $('#options');
        if (!optionsMenu.length) {
            console.warn('[ST-Seele-Tools] Menu not found. Cannot add save button.');
            return;
        }
        $extensionsMenu = optionsMenu;
    }
    const $seeleButton = $(`
        <div id="seele_tools_button" class="list-group-item flex-container flexGap5 interactable tavern-helper-shortcut-item">
            <div class="fa-solid fa-seedling extensionsMenuExtensionButton"></div><span>希儿工具箱</span>
        </div>
    `);
    $seeleButton.on('click', () => {openMenu()});
    $extensionsMenu.children().last().before($seeleButton);
}

// 双击聊天栏启动菜单
function updateFastOpen() {
    $('#chat').off('.seeleFastOpen');
    if (dataManager.extConf.fastOpen) {
        let fastOpenTimer = null;
        $('#chat').on('click.seeleFastOpen', '.mes', (e) => {
            if (e.detail == 2) {
                e.preventDefault();
                fastOpenTimer = setTimeout(() => {openMenu(e)}, 250);
            } else {
                clearTimeout(fastOpenTimer);
            }
        });
    }
}

// 自动跳转至最新回复
const autoJumpFunc = () => jumpToMsg(-1); 
function updateAutoJump() {
    eventManager.remove("character_message_rendered", autoJumpFunc);
    if (dataManager.extConf.autoJump) eventManager.makeLast("character_message_rendered", autoJumpFunc);
}

// 点击编辑框外部保存
function updateOutSave() {
    $(document).off('.seeleOutSave');
    if (dataManager.extConf.outSave) {
        $(document).on('mousedown.seeleOutSave', (e) => {
            if ($('#seele-menu').length) return;
            if ($(e.target).closest('#leftSendForm, #options, #extensionsMenu').length) return;
            const $editorMes = $('#curEditTextarea').closest('.mes');
            if ($editorMes.length && !$editorMes[0].contains(e.target)) $editorMes.find('.mes_edit_done').trigger('click');
        });
    }
}

// 书签切换
function updateBookmark(mesid="") {
    const maxMesId = Number(ctx().substituteParamsExtended('{{lastMessageId}}'));
    const mark_str = dataManager.chatConf.bookMarks;
    let mark_list = mark_str.split(',').filter(t => t.trim());
    if (mesid) {
        if (Number(mesid) < 0) {
            mark_list = [];
        } else if (mark_list.includes(mesid)) {
            mark_list = mark_list.filter(id => id != mesid);
            toastr.info(`书签 #${mesid} 已移除`);
        } else {
            mark_list.push(mesid);
            toastr.success(`书签 #${mesid} 已添加`);
        }
    }
    mark_list = mark_list.filter(id => Number(id) <= maxMesId).sort((a, b) => Number(a) - Number(b));
    if (mark_list.join(',') != mark_str) {
        dataManager.chatConf.bookMarks = mark_list.join(',');
        dataManager.chatSave();
    }
    return mark_list;
}

// 获取正则列表
function getRegexs(use=false) {
    const globals = ctx().extensionSettings?.regex ?? [];
    const presets = oai_settings?.extensions?.regex_scripts ?? [];
    const chars = ctx().characters[ctx().characterId]?.data?.extensions?.regex_scripts ?? [];
    const regexMap = new Map();
    const useIds = dataManager.extConf.regexIds
    for (const rule of [...globals, ...presets, ...chars]) {
        if (!rule.id || use && !useIds.includes(rule.id)) continue;
        if (rule.promptOnly && !rule.markdownOnly) continue;
        if (!rule.placement.length || !rule.placement.includes(2)) continue;
        regexMap.set(rule.id, {
            name: rule.scriptName ?? '',
            find: rule.findRegex ?? '',
            replace: rule.replaceString ?? ''
        });
    }
    return regexMap;
}

// 获取消息列表
function getChats(replace=true) {
    let regex_list = [];
    let black_regex = null;
    let white_regex = null;
    if (replace) {
        const extConf = dataManager.extConf;
        [black_regex, white_regex] = [extConf.blackTags, extConf.whiteTags].map(s => {
            const tags = s.split(',').map(t => t.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(t => t);
            return tags.length ? new RegExp(`<(${tags.join('|')})[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi') : null;
        });
        getRegexs(true).forEach(rule => {
            try {
                let pattern = rule.find.trim();
                if (!pattern) return;
                let replace = rule.replace.trim();
                let flag = "gi"
                if (pattern.startsWith('/')) {
                    const index = pattern.lastIndexOf('/');
                    if (index > 0) {
                        flag = pattern.slice(index + 1);
                        pattern = pattern.slice(1, index);
                    }
                }
                const regex = new RegExp(pattern, flag);
                regex_list.push({ regex, replace });
            } catch (e) {
                console.warn(`[ST-Seele-Tools] Invalid regex: ${rule.name}`);
            }
        });
    }

    const chat_list = [];
    ctx().chat.forEach((msg, index) => {
        let mes = msg.mes;
        if (replace && !msg.is_user) {
            if (black_regex) mes = mes.replace(black_regex, '');
            if (white_regex) mes = [...mes.matchAll(white_regex)].map(m => m[0]).join('\n').trim();
            for (const { regex, replace } of regex_list) {
                try {mes = mes.replace(regex, replace)} catch (e) {}
            }
        }
        chat_list.push({id: index, name: msg.name, is_user: msg.is_user, mes: mes})
    });
    return chat_list
}

// 跳转指定消息
async function jumpToMsg(index) {
    let mesIndex = Number(index);
    if (isNaN(mesIndex)) return;
    await delay(100);
    const minMesId = getFirstDisplayedMessageId();
    const maxMesId = Number(ctx().substituteParamsExtended('{{lastMessageId}}'));
    if (mesIndex < 0 || mesIndex > maxMesId) mesIndex = maxMesId;
    if (isFinite(minMesId) && mesIndex < minMesId) {
        await showMoreMessages(minMesId - mesIndex);
        await delay(1);
    }
    const $target = $(`#chat .mes[mesid="${mesIndex}"]`);
    if ($target.length) {
        $target[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
}

// 导出文件
function exportFile(content, filename, type = 'text/plain') {
    if (!content) return false;
    try {
        const blob = new Blob([content], { type: type + ';charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename; a.click();
        URL.revokeObjectURL(a.href);
        return true;
    } catch (e) { return false; }
}

// 初始化
$(document).ready(function() {
    const buttonInterval = setInterval(() => {
        if ($('#extensionsMenu').length || $('#options').length) {
            addMenuButton();
            updateFastOpen();
            updateAutoJump();
            updateOutSave();
            clearInterval(buttonInterval);
        }
    }, 500);    
});
