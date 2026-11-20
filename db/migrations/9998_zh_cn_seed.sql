-- Translate only untouched starter-building data created by older English versions.
-- User-renamed departments and bots are intentionally left alone.

update public.departments
set name = case name
  when 'Head office' then '总控办公室'
  when 'Assistant' then '助理'
  when 'Research' then '研究'
  when 'Engineering' then '工程'
  else name
end
where (kind = 'head' and name = 'Head office')
   or (kind = 'assistant' and name = 'Assistant')
   or (kind = 'research' and name = 'Research')
   or (kind = 'engineering' and name = 'Engineering');

update public.bots
set name = '幕僚长',
    instructions = '规划用户需求，拆成任务并交给合适的楼层。团队缺少能力时，提议创建新的 Bot 或部门。'
where name = 'Chief of Staff'
  and instructions = 'Plan the user''s requests, split them into tasks and delegate them to the right floor. Propose new bots or departments when the team is missing a skill.';

update public.bots
set name = '收件箱助手',
    instructions = '整理收件箱、起草回复并管理日程。发送任何内容前都必须先征求确认。'
where name = 'Inbox Zero'
  and instructions = 'Triage the inbox, draft replies and manage the calendar. Always ask before sending anything.';

update public.bots
set name = '每日简报',
    instructions = '根据邮件和日程生成简短的每日早报。'
where name = 'Daily Brief'
  and instructions = 'Write a short morning brief from email and calendar.';

update public.bots
set name = '研究员',
    instructions = '负责研究需求：搜索网页、读取页面，并把较大的问题拆分给研究楼层。'
where name = 'Scout'
  and instructions = 'Lead research requests: search the web, read pages and split bigger questions across the floor.';

update public.bots
set name = '价格监控',
    instructions = '监控商品价格，并在低于阈值时报告。'
where name = 'Price Watcher'
  and instructions = 'Watch product prices and report drops below the threshold.';

update public.bots
set name = '技术主管',
    instructions = '拆分工程任务，评审执行 Bot 的 Pull Request，并在合并前征求确认。'
where name = 'Tech Lead'
  and instructions = 'Break engineering work down, review the builders'' pull requests and ask before merging.';

update public.bots
set name = '工程师',
    instructions = '在沙箱中完成指定任务并创建草稿 Pull Request。'
where name = 'Builder'
  and instructions = 'Implement scoped tasks in the sandbox and open draft pull requests.';
