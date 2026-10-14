# Appendix C. Decisions that need Tim

Part of the [studio design spec](README.md). Each decision has the options, the benefits and drawbacks of each, a recommendation, and the evidence to deep-dive. Nothing here is in force until Tim rules. Settled items are listed first so they are not reopened.

## Settled (do not reopen)

| Ruling | Date | Where recorded |
|---|---|---|
| Engines run only in Docker Sandboxes; never bypass on the host; the Max login pays; the supervisor is the independent durable driver | 2026-09-26 | [planning pass §1](../../briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md) |
| Hermes never runs `claude -p` for pipeline work | 2026-09-26 | same, Phase 2 hard rule |
| TUA is the game reference and stays its own repository | standing | handoffs |
| The gamified office is the surface Tim will use most; no third repository; one installer, setup and updater as a hard gate; Next.js first; the contract-studio engagement vision | 2026-10-09 | [10-09 handoff](../../../implementation-artifacts/handoff-phase1-loop-2026-10-09.md) |
| **O5: keep the plugin form, drop the marketplace; the installer writes a skills-dir plugin** | **2026-10-09, Tim: "I'm fine with O5"** | [ADR §2 O5](../../briefs/adr-repository-structure-2026-10-09.md#o5-keep-the-plugin-form-drop-the-marketplace-an-installer-written-skills-dir-plugin-recommended-as-the-distribution-overlay-on-o2); recorded in the ADR header by this PR |

## D1. Repository

O2 - one repository with per-app releases

## D2. Hermes

B - Drop Hermes; studio owns its chat over Claude Code

Reasoning:
After reviewing everything, Hermes is more adjacent rather than a core part of the studio workflow. One of the things that has been a bit flakey has been the self evolution/dreaming functionality - I haven't even really tested tk-studio's flow for this at all yet because we've been developing the tool more than using it which is fine for the moment but one of the reasons I was set on Hermes agent being a part of it was the agent registry and it's ability to do its own evolutions. However, for new users who may not use Hermes this becomes a blocker. If we just use it as an adapter behine the supervisor owned chat I feel like we're running two parallel systems that are more likely to conflict than cooperate. So, I think it's better to just build in the functionality I want as it becomes necessary. All of Hermes existing functionality is nice, but it's all very generic and making the studio dependent on it just complicates things. If we need to create our own bot, cron, memory, etc. then that is what we will do. I'm good with losing the telegram integration for now while we rebuild a tk-studio native version or even create something different. 

## D3. Order of work

**(iii) then (ii) then (i)**

## D4. Quote basis

Both, with dollars as the shadow figure.

## D5. Renderer

So my answer to this is a bit of a change of spec from what I said before and I'd like your feedback on it:

I originally wanted this to run in NextJS but after more thought on this I don't think it's really necessary to do so since this is meant to be installed on a dedicated machine and accessed via the web which needs to communicate directly with the services running on that machine such as Claude Code, Blender, Godot, etc. Introducing NextJS into this feels like an extra step requiring additional infrastructure that ultimately ends up being communication with that machine. Basically a REST(or some other protocol) api that just talks with the studio requiring more networking setup and possible pitfalls. If people need to access the studio from public https then I'd rather require the user to open up a port in their firewall and configure DNS to access the machine from the outside web securing the connection with Oauth/login for the user(s) that need to access it. The decision to drop Hermes simplifies things here as well. The web server just runs on the local machine and communicates directly with it. 

Also, I think trying to make the studio comfortably usable from a phone via the full web UI would be a difficult task. I think serving a separate phone-friendly web UI would be the better approach here that doesn't have the full studio visualization is the way to go and we develop this after the full web UI is complete.This way, we would be able to focus more on functionality and once that all is nailed down we can look at mobile browsers. I will primarily be using this from my PC, laptop or iPad which have much more screen real estate than a phone. So at first we have a single web UI for all browsers and once that is complete and known working we can look at a mobile version.

Looking at the different frameworks I think PixiJS gets my vote. I'd rather use a framework than hand rolling everything and I don't really want to have to do this with a game engine app and export the entire thing to the web. It opens up more options more easily as the studio evolves and the speed and ease of use of PixiJS is well documented. 

## D6. Assets

Regarding the assets themselves, I say we look at existing assets available and then just create our own versions of them via 2d art development tools on this PC. I have an adobe creative cloud subscription that we can use or we can find other apps to create 2d assets pretty easily that have strong agentic tools and/or MCP. Then we can include the assets in the repo. 

## D7. Sign-in

Drop the external auth providers and have a solo user account for now with token cookie to initially set up the username/password for access to make it easier to log in via password managers like LastPass or 1Password. 

Reasoning:
We basically restrict usage to the user who set up the studio and whose Claude Code user is logged in. This solves the API key issue below from an ethics standpoint and just make sure we clearly state that this is the intended usage. If people share their tk-studio login with others that's not something we can really control nor should we.

I do want to support multiple users for the same studio eventually but for now I don't want to run into any legal trouble so this feels the safest route for now. 

## D8. API-key fallback

See above answer.

## Other feedback

# Project identity, tracking and focus
For each engagement that the studio is working on we will need to setup a project to track the work and a board to show said work and status of each issue as well as a knowledge base. I think we should utilize existing solutions for this rather than just roll our own here. Atlassian cloud shows free usage for small teams up to 10 users for both confluence and jira which I think is a steal for what it provides. I also know they have strong MCP support for both. This also allows us to focus on the studio development rather than issue tracking and knowledge base tool creation. This also allows the user to view the studio work from other devices without having to access the studio site itself allowing them to respond to blocked issues as well as even add attachments to comments, descriptions, etc. in issues or in confluence. Both have unlimited projects and spaces so I think this would be a huge benefit. We could setup a user for the agent along with API keys so really we would only use 2 users out of the 10 free ones for the jira and confluence accounts. The setup is easy and having separate users would more easily allow the studio to differentiate between what it posts and what the user does. We would regularly sync from jira/confluence back to local memory for the studio so we'd always be looking at the most up to date information and not have to make the agents regularly query to get info, therefore saving tokens/usage. The workflow would be to publish changes to atlassian and then sync back as a CRON job or something every so often on a configurable timer. When a user starts up a new project or wants to continue an existing one from a github repo or just local files, as part of the setup the studio would create a confluence space and a linked jira project and then go through and setup everything such as the folder structure in confluence for all docs, the jira workflows for statuses, etc. This might not all be possible through MCP so some things may need to be done via the browser or require the user to do some basic setup but we can possibily create a template and have the user use it. Then as they go through the design phase we'd publish the info to confluence pages and also request further information there. They would be able to upload reference images, write out specs, design decisions, etc. all directly in confluence rather than having to support everything in our UI from the very start. Over time we can maybe adopt more local functionality to allow for this but at least to start this would be a powerful tool. 

# User feedback and communications:
I feel like we need to more clearly define how this works and I keep thinking about how Jira handles this - each epic/story/task/subtask (issue) allow comments to be posted on them. If a story gets blocked for any reason and cannot progress, we could do something similar - basically set the issue status (and any dependents) to "blocked-awaiting user" and put the reasoning in a "comment" tagging the user (@username) which would get picked up by the system and the user would have an "inbox" where they would be able to see a list of issues needing their attention all in one place sorted by priority then date/time. Clicking the issue would open the issue in a jira-like interface and allow them to directly respond via text or if the issue is something simple like a request to do something i.e. "install app X on machine", "run command X as admin in powershell", etc. there could be a button that just says "Done" or "Request complete" or something like that and it injects that text into the comment and the user can hit "Reply" and that would clear the item from the user's "inbox" and the issue status would go back to "To Do" or possibly a new status like "Block Resolved" which would then allow an agent to validate the resolution - if they needed something done then test if they can do the thing or if feedback was needed is the response complete enough for development of that issue to continue or if there are more questions, then the agent can move the issue back to "blocked" status and reply to the user's comment, putting another item in the user's "inbox"

# Project Asset Creation
Came across a good post on X that has several github repos that turn opus 5.5 into a full 3d studio. This isn't necessarily a list of things I want installed but a good resource for things for future use. 
Here is the text copied from it:
GENERATE 3D ASSETS

01. TRELLIS.2 by Microsoft:
http://github.com/microsoft/TRELLIS.2
-> one image in, a fully textured 3D asset out, about 3 seconds on an H100

02. Hunyuan3D-2.1 by Tencent:
http://github.com/Tencent-Hunyuan/Hunyuan3D-2.1
-> production-ready 3D assets with PBR textures

03. stable-fast-3d by Stability AI:
http://github.com/Stability-AI/stable-fast-3d
-> one photo to a clean UV-unwrapped mesh, built for speed

04. meshy-mcp-server by Meshy:
http://github.com/meshy-dev/meshy-mcp-server
-> text or image to 3D, then remesh, retexture, rig and animate from your agent

BUILD SCENES AND WORLDS

05. mcp-for-blender:
http://github.com/ahujasid/mcp-for-blender
-> prompt-driven modeling, scene building and edits in a live Blender

06. HY-World-2.0 by Tencent:
http://github.com/Tencent-Hunyuan/HY-World-2.0
-> text or a single image to a navigable 3D world

07. supersplat by PlayCanvas:
http://github.com/playcanvas/supersplat
-> inspect, edit, optimize and publish 3D Gaussian splats in the browser

08. kit-usd-agents by NVIDIA:
http://github.com/NVIDIA-Omniverse/kit-usd-agents
-> edit Omniverse USD scenes in plain English, plus MCP servers for Kit and Isaac Sim

MAKE A GAME

09. unity-mcp:
http://github.com/CoplayDev/unity-mcp
-> run the Unity Editor in plain English: scenes, C# scripts, assets, tests, builds

10. godot-ai:
http://github.com/hi-godot/godot-ai
-> 46 tools for a live Godot editor: scenes, scripts, signals, UI, particles

11. unreal-engine-mcp:
http://github.com/flopperam/unreal-engine-mcp
-> drive a live Unreal Editor: actors, world building, Blueprints

3D ON THE WEB

12. editor-mcp-server by PlayCanvas:
http://github.com/playcanvas/editor-mcp-server
-> your agent builds PlayCanvas scenes and checks they actually run

13. three.js:
http://github.com/mrdoob/three.js
-> the JavaScript 3D library itself, 115k stars on GitHub

14. react-three-fiber:
http://github.com/pmndrs/react-three-fiber
-> build three.js scenes as reusable React components

15. threejs-skills:
http://github.com/CloudAI-X/threejs-skills
-> 10 three.js skills for Claude Code, from shaders to post-processing

a full 3D pipeline, and every piece of it lives on github



