(function ($) {
  "use strict";

  // VERSION CHECK
  console.log("FCO App v17.22 Loaded (UX Performance Pack)");

  const App = {
    data: null,
    activeId: null, // Current Page ID
    activeTab: "pages", // pages, setup, branding, team, blog, shop
    saveTimer: null,
    wizardState: {},
    wpEditorId: null,
    lastWizardRenderKey: null,

    COMMON_PAGES: [
      "Home", "About", "Services", "Contact", "Blog", "Shop",
      "Privacy Policy", "Terms", "FAQ", "Portfolio", "Careers", "Team"
    ],

    // REDUCED TO 6 SWATCHES AS REQUESTED
    BRAND_SWATCHES: [
      { name: "Primary", hex: "#4f46e5", pantone: "" },
      { name: "Secondary", hex: "#0ea5e9", pantone: "" },
      { name: "Accent", hex: "#22c55e", pantone: "" },
      { name: "Text", hex: "#0f172a", pantone: "" },
      { name: "Background", hex: "#ffffff", pantone: "" },
      { name: "Border", hex: "#e2e8f0", pantone: "" }
    ],

    // ------------------------------------------------------------
    // INIT
    // ------------------------------------------------------------
    init: async function () {
      if (!window.FCO_Config || !FCO_Config.api) {
        $("#fco-client-app").html('<div class="fco-error">Missing Configuration (FCO_Config).</div>');
        return;
      }

      // UX Pack: Inject busy style if not present
      if ($("#fco-ux-style").length === 0) {
          $("head").append(`<style id="fco-ux-style">.fco-btn.is-busy { opacity:0.7; pointer-events:none; cursor:wait !important; }</style>`);
      }

      // Prefer config pages list if supplied
      if (Array.isArray(FCO_Config.commonPages) && FCO_Config.commonPages.length) {
        this.COMMON_PAGES = FCO_Config.commonPages;
      }

      this.applyResponsiveClass();
      $(window).on("resize", () => this.applyResponsiveClass());

      this.guardAdminForm();

      // Close dropdowns on outside click
      $(document).on("click", (e) => {
        if (!$(e.target).closest(".fco-dropdown").length) $(".fco-dropdown-menu").removeClass("show");
        // Close new menu
        if (!$(e.target).closest("#fco-menu-toggle, #fco-main-menu").length) $("#fco-main-menu").removeClass("show");
      });

      await this.loadProject();
    },

    applyResponsiveClass: function () {
      $("body").toggleClass("fco-mobile", $(window).width() < 1000);
    },

    guardAdminForm: function () {
      if ($("body.wp-admin").length === 0) return;

      $("form#post").on("submit", function (e) {
        const submitter = e.originalEvent && e.originalEvent.submitter ? e.originalEvent.submitter : null;
        if (submitter && $(submitter).closest("#fco-client-app").length) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      });
    },

    // ------------------------------------------------------------
    // API HELPERS
    // ------------------------------------------------------------
    apiGet: function (path, data = {}) {
      data._cb = new Date().getTime(); // Explicit cache buster
      return $.ajax({
        url: `${FCO_Config.api.root}${path}`,
        method: "GET",
        data,
        cache: false,
        beforeSend: (xhr) => xhr.setRequestHeader("X-WP-Nonce", FCO_Config.api.nonce)
      });
    },

    apiPost: function (path, payload = {}) {
      return $.ajax({
        url: `${FCO_Config.api.root}${path}`,
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify(payload),
        beforeSend: (xhr) => xhr.setRequestHeader("X-WP-Nonce", FCO_Config.api.nonce)
      });
    },

    // ------------------------------------------------------------
    // DATA LOAD + MODE
    // ------------------------------------------------------------
    loadProject: async function () {
      try {
        let res = await this.apiGet("/project/current", { project_id: FCO_Config.projectId });
        
        // Safety: Handle if response is a string
        if (typeof res === "string") {
            try { res = JSON.parse(res); } catch (e) { console.warn("Failed to parse response", e); }
        }

        this.data = res || {};

        // 1. Core Objects
        this.data.project = this.data.project || {};
        this.data.branding = this.data.branding || {};
        this.data.content = this.data.content || {}; 
        this.data.pages = Array.isArray(this.data.pages) ? this.data.pages : [];
        this.data.drafts = this.data.drafts || {};
        // Ensure comments object exists
        this.data.comments = this.data.comments || {};

        // 2. Branding Sub-properties
        this.data.branding.assets = Array.isArray(this.data.branding.assets) ? this.data.branding.assets : [];
        this.data.branding.inspiration_links = Array.isArray(this.data.branding.inspiration_links) ? this.data.branding.inspiration_links : ["", "", "", "", "", ""]; // 6 links for Task 6
        this.data.branding.socials = Array.isArray(this.data.branding.socials) ? this.data.branding.socials : [];
        this.data.branding.contact = this.data.branding.contact || { address: "", emails: [], phones: [] };
        
        this.data.branding.fonts = Array.isArray(this.data.branding.fonts) ? this.data.branding.fonts : [
          { label: "Primary", name: "", url: "" },
          { label: "Secondary", name: "", url: "" },
          { label: "Tertiary", name: "", url: "" },
          { label: "Other", name: "", url: "" }
        ];

        this.data.branding.colors = Array.isArray(this.data.branding.colors) ? this.data.branding.colors : [];
        if (!this.data.branding.colors.length) {
          this.data.branding.colors = JSON.parse(JSON.stringify(this.BRAND_SWATCHES));
        }

        // 3. Content Sub-properties
        this.data.content.staff = Array.isArray(this.data.content.staff) ? this.data.content.staff : [];
        this.data.project.wp_users = Array.isArray(this.data.project.wp_users) ? this.data.project.wp_users : [];

        // 4. Mode Switching
        if (FCO_Config.isAdmin) {
          this.switchMode("editor");
        } else if (this.data.project.wizard_complete) {
          this.switchMode("editor");
        } else {
          this.switchMode("start");
        }
      } catch (e) {
        console.error("FCO Load Error:", e);
        let msg = e.message || "Unknown error";
        if (e.status) msg += ` (Status: ${e.status})`;
        $("#fco-client-app").html(`<div class="fco-error">Error loading project: ${this.escapeHtml(msg)} <br>Check console for details.</div>`);
      }
    },

    switchMode: function (mode) {
      this.destroyWpEditor();

      const $root = $("#fco-client-app");
      $root.attr("class", "").addClass(`mode-${mode}`);
      $root.empty();

      if (mode === "start") this.renderStart($root);
      if (mode === "wizard") this.renderWizard($root);
      if (mode === "editor") this.renderEditor($root);
    },

    // ------------------------------------------------------------
    // START SCREEN
    // ------------------------------------------------------------
    renderStart: function ($el) {
      const name = (FCO_Config.user && FCO_Config.user.name) ? FCO_Config.user.name : "there";

      $el.html(`
        <div class="fco-start-hero">
          <div class="fco-start-kicker">Welcome, ${this.escapeHtml(name)}</div>
          <h1 class="fco-start-title">Let’s build your foundation.</h1>
          <p class="fco-start-sub">
            We’ll collect your branding, structure your content, team info, and set up your store if needed.
          </p>
          <div class="fco-start-actions">
            <button class="fco-btn primary large" id="btn-begin">
              Start Onboarding <span aria-hidden="true">→</span>
            </button>
            <button class="fco-btn ghost large" id="btn-skip">
              Skip to Dashboard
            </button>
          </div>
        </div>
      `);

      $("#btn-begin").on("click", (e) => { e.preventDefault(); this.switchMode("wizard"); });
      $("#btn-skip").on("click", (e) => { e.preventDefault(); this.switchMode("editor"); });
    },

    // ------------------------------------------------------------
    // EDITOR DASHBOARD (MAIN)
    // ------------------------------------------------------------
    renderEditor: function ($el) {
      const isAdmin = !!FCO_Config.isAdmin;
      const compName = this.data.branding.company_name || this.data.project.company_name || "Project";
      // HARDCODED LOGO PATH (Editor)
      const logoUrl = "/wp-content/plugins/foundation-content-onboard/assets/Inkfirelogo.png";
      
      $el.html(`
        <div class="fco-portal-wrap">
          <header class="fco-header">
            <div class="fco-head-left">
              <div class="fco-logo-mark" aria-hidden="true">
                  <img src="${logoUrl}" alt="Inkfire logo" style="width:100%; height:100%; object-fit:contain; border-radius:inherit;">
              </div>
              <div class="fco-head-titles">
                <div class="fco-head-title">Content Onboard</div>
                <div class="fco-head-sub">${this.escapeHtml(compName)}</div>
              </div>
            </div>
            <div class="fco-head-right">
              <div class="fco-head-actions">
                ${isAdmin ? `
                  <button class="fco-btn primary small" id="btn-sync-pages">Sync to WordPress</button>
                ` : ``}
                
                <button class="fco-menu-btn" id="fco-menu-toggle" aria-label="Menu" title="Options">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                </button>
                
                <!-- HAMBURGER DROPDOWN -->
                <div class="fco-menu-dropdown" id="fco-main-menu">
                    ${isAdmin ? `
                        <button class="fco-menu-item" id="btn-email-summary">Email Summary</button>
                        <button class="fco-menu-item" id="btn-export">Export JSON</button>
                        <label class="fco-file-menu-item"><span class="fco-menu-item">Import JSON</span><input type="file" id="btn-import" accept=".json" style="display:none;"></label>
                        <button class="fco-menu-item danger" id="btn-reset-wiz">Reset Wizard</button>
                    ` : ``}
                    <button class="fco-menu-item" id="btn-open-wiz">Open Wizard</button>
                </div>
              </div>
              <div class="fco-save-indicator" aria-live="polite">Saved</div>
            </div>
          </header>

          <div class="fco-toolbar">
              <nav class="fco-tab-nav">
                 <button class="fco-tab-btn ${this.activeTab === 'pages' ? 'active' : ''}" data-tab="pages">Pages</button>
                 <button class="fco-tab-btn ${this.activeTab === 'setup' ? 'active' : ''}" data-tab="setup">Setup</button>
                 <button class="fco-tab-btn ${this.activeTab === 'branding' ? 'active' : ''}" data-tab="branding">Branding</button>
                 <button class="fco-tab-btn ${this.activeTab === 'team' ? 'active' : ''}" data-tab="team">Team</button>
                 <button class="fco-tab-btn ${this.activeTab === 'blog' ? 'active' : ''}" data-tab="blog">Blog</button>
                 <button class="fco-tab-btn ${this.activeTab === 'shop' ? 'active' : ''}" data-tab="shop">Shop</button>
              </nav>
          </div>
          
          <div class="fco-stage" id="fco-tab-stage">
            </div>
        </div>
      `);

      $("#btn-open-wiz").on("click", () => this.switchMode("wizard"));
      
      // Menu Toggle Logic
      $("#fco-menu-toggle").on("click", (e) => {
          e.stopPropagation();
          $("#fco-main-menu").toggleClass("show");
      });

      $(".fco-tab-btn").on("click", (e) => {
         const t = $(e.currentTarget).data("tab");
         this.activeTab = t;
         $(".fco-tab-btn").removeClass("active");
         $(e.currentTarget).addClass("active");
         this.renderTabContent(); 
      });

      if (isAdmin) {
        $("#btn-export").on("click", () => this.exportJson());
        $("#btn-import").on("change", (e) => this.importJson(e));
        $("#btn-sync-pages").on("click", () => this.syncToWpDraftPages());
        $("#btn-email-summary").on("click", () => this.sendEmailSummary());
        
        // RESET WIZARD BUTTON LOGIC
        $("#btn-reset-wiz").on("click", () => {
            if(!confirm("Reset Wizard Status?\n\nThis will force the client to see the start screen/wizard again.\n\nNO DATA WILL BE DELETED.")) return;
            this.data.project.wizard_complete = false;
            this.saveData(true).then(() => {
                alert("Wizard status reset. Reloading...");
                window.location.reload();
            });
        });
      }

      this.renderTabContent();
    },

    renderTabContent: function() {
        const $stage = $("#fco-tab-stage");
        $stage.empty();
        this.destroyWpEditor();

        if (this.activeTab === "pages") {
            this.renderPagesTab($stage);
        } else if (this.activeTab === "setup") {
            this.renderSetupTab($stage);
        } else if (this.activeTab === "branding") {
            this.renderBrandingTab($stage);
        } else if (this.activeTab === "team") {
            this.renderTeamTab($stage);
        } else if (this.activeTab === "blog") {
            this.renderBlogTab($stage);
        } else if (this.activeTab === "shop") {
            this.renderShopTab($stage);
        }
    },

    // ------------------------------------------------------------
    // TAB: PAGES (Original Editor)
    // ------------------------------------------------------------
    renderPagesTab: function($stage) {
        const isAdmin = !!FCO_Config.isAdmin;
        const canStructure = isAdmin || !!FCO_Config.clientCanEditStructure;
        
        // REMOVED THE ASIDE PANEL FROM THE GRID
        $stage.html(`
          <div class="fco-grid">
            <aside class="fco-sidebar">
              ${canStructure ? `<div class="fco-tree-controls"><button class="fco-btn primary small full" id="btn-add-page">+ Add Page</button><div class="fco-hint-sm">Drag to reorder. Drag right to nest.</div></div>` : ``}
              <div class="fco-nav-header">Structure</div>
              <ul id="fco-nav-list" class="fco-tree-list" aria-label="Site structure"></ul>
            </aside>
            <main class="fco-editor" aria-label="Editor panel"><div id="fco-editor-container"></div></main>
          </div>
        `);

        if (canStructure) $("#btn-add-page").on("click", () => this.addPageInline());
        this.renderNav({ enableDnD: canStructure });
        
        if (this.activeId && this.data.pages.find(p=>p.id===this.activeId)) {
            this.loadPageEditor(this.activeId);
        } else if (this.data.pages.length > 0) {
            this.loadPageEditor(this.data.pages[0].id);
        } else {
            this.loadPageEditor(null);
        }
    },

    // ------------------------------------------------------------
    // TAB: SETUP
    // ------------------------------------------------------------
    renderSetupTab: function($stage) {
        const p = this.data.project;
        const b = this.data.branding;
        
        $stage.html(`
            <div class="fco-dash-scroller">
                <div class="fco-dash-container">
                    <h2>Website Setup</h2>
                    <div class="fco-card">
                        <div class="fco-field-group">
                             <label class="fco-label">Company / Site Name</label>
                             <input class="fco-input bind-data" data-target="branding.company_name" value="${this.escapeAttr(b.company_name)}">
                        </div>
                         <div class="fco-field-group">
                             <label class="fco-label">Tagline</label>
                             <input class="fco-input bind-data" data-target="branding.tagline" value="${this.escapeAttr(b.tagline)}">
                        </div>
                        <div class="fco-field-group">
                             <label class="fco-label">One Liner (Footer Description)</label>
                             <textarea class="fco-input bind-data" data-target="branding.one_liner" rows="2">${this.escapeHtml(b.one_liner)}</textarea>
                        </div>
                    </div>

                    <h2>Admin & Technical</h2>
                    <div class="fco-card">
                         <div class="fco-field-group">
                             <label class="fco-label">Admin Email Address</label>
                             <input class="fco-input bind-data" data-target="project.admin_email" value="${this.escapeAttr(p.admin_email)}">
                        </div>
                         <div class="fco-field-group">
                             <label class="fco-label">Existing Website URL</label>
                             <input class="fco-input bind-data" data-target="project.existing_website" value="${this.escapeAttr(p.existing_website)}">
                        </div>
                    </div>

                    <h2>WordPress Users</h2>
                    <div class="fco-card">
                        <div id="dash-user-list"></div>
                        <button class="fco-btn ghost small full" id="dash-add-user" style="margin-top:15px;">+ Add User</button>
                    </div>
                </div>
            </div>
        `);
        
        this.bindDataInputs($stage);
        this.renderUserListManager("#dash-user-list");
        $("#dash-add-user").on("click", () => {
             this.data.project.wp_users.push({username:"", first_name:"", last_name:"", role:"editor"});
             this.renderUserListManager("#dash-user-list");
             this.saveData(true);
        });
    },

    // ------------------------------------------------------------
    // TAB: BRANDING
    // ------------------------------------------------------------
    renderBrandingTab: function($stage) {
         // Replacement for External Image Meta Box: Featured Image Field
         const featImg = this.data.branding.featured_image || "";

         $stage.html(`
            <div class="fco-dash-scroller">
                <div class="fco-dash-container">
                    
                    <h2>Brand Assets (Logo, Icon)</h2>
                    <div class="fco-card">
                        <div class="fco-media-grid" id="dash-mediagrid"></div>
                        <button class="fco-btn primary small" id="dash-upload-asset" style="margin-top:15px;">+ Upload Assets</button>
                    </div>

                    <h2>Featured Image / Cover</h2>
                    <div class="fco-card">
                        <label class="fco-label">Main Project Image (replaces external featured image)</label>
                        <div style="display:flex; gap:15px; align-items:center;">
                            <input class="fco-input" id="dash-feat-img-url" value="${this.escapeAttr(featImg)}" placeholder="Image URL">
                            <button class="fco-btn ghost small" id="dash-upload-feat">Select</button>
                        </div>
                        ${featImg ? `<div style="margin-top:10px;"><img src="${this.escapeAttr(featImg)}" style="max-height:150px; border-radius:8px; border:1px solid #e2e8f0;"></div>` : ''}
                    </div>

                    <h2>Brand Colors</h2>
                    <div class="fco-card">
                        <div id="dash-palette-stage"></div>
                    </div>

                    <h2>Typography</h2>
                    <div class="fco-card">
                        <div id="dash-typo-grid" class="fco-typo-grid"></div>
                    </div>
                    
                    <h2>Inspiration</h2>
                    <div class="fco-card">
                         <label class="fco-label">Top Inspiration Links</label>
                         <div style="display:grid; gap:10px; margin-bottom:15px;" id="dash-insp-list"></div>
                         <label class="fco-label">Style Notes</label>
                         <textarea class="fco-input bind-data" data-target="branding.style_notes" rows="4">${this.escapeHtml(this.data.branding.style_notes)}</textarea>
                    </div>

                    <h2>Email Identity</h2>
                    <div class="fco-card">
                         <label class="fco-label">Email Signature / Footer</label>
                         <textarea class="fco-input bind-data" data-target="branding.email_signature" rows="4" placeholder="Paste your email signature HTML or text here...">${this.escapeHtml(this.data.branding.email_signature || "")}</textarea>
                    </div>
                </div>
            </div>
         `);

         this.renderPaletteManager("#dash-palette-stage");
         this.renderTypoManager("#dash-typo-grid");
         this.renderAssetManager("#dash-mediagrid");
         this.renderInspirationManager("#dash-insp-list");
         this.bindDataInputs($stage);
         
         // Featured Image Logic
         $("#dash-feat-img-url").on("input", (e) => {
             this.data.branding.featured_image = $(e.target).val();
             this.debouncedSave();
         });
         $("#dash-upload-feat").on("click", () => {
            if (!window.wp || !wp.media) return;
            const frame = wp.media({ title: "Select Featured Image", button: {text:"Select"}, multiple: false });
            frame.on("select", () => {
              const att = frame.state().get("selection").first().toJSON();
              this.data.branding.featured_image = att.url;
              this.renderBrandingTab($stage); // Re-render to show preview
              this.saveData(true);
            });
            frame.open();
         });

         $("#dash-upload-asset").on("click", () => {
            if (!window.wp || !wp.media) return;
            const frame = wp.media({ title: "Select Branding", button: {text:"Add"}, multiple: true });
            frame.on("select", () => {
              const selection = frame.state().get("selection");
              selection.map(att => { const json = att.toJSON(); this.data.branding.assets.push({ id: json.id, url: json.url }); });
              this.renderAssetManager("#dash-mediagrid");
              this.saveData(true);
            });
            frame.open();
         });
    },

    // ------------------------------------------------------------
    // TAB: TEAM
    // ------------------------------------------------------------
    renderTeamTab: function($stage) {
        $stage.html(`
            <div class="fco-dash-scroller">
                <div class="fco-dash-container">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h2>Team Members</h2>
                        <button class="fco-btn primary small" id="dash-add-staff">+ Add Member</button>
                    </div>
                    <div class="fco-card">
                        <div id="dash-staff-list"></div>
                    </div>
                </div>
            </div>
        `);
        
        this.renderStaffManager("#dash-staff-list");
        $("#dash-add-staff").on("click", () => {
             this.data.content.staff.push({name:"", position:"", bio:"", image:""});
             this.renderStaffManager("#dash-staff-list");
             this.saveData(true);
        });
    },

    // ------------------------------------------------------------
    // TAB: BLOG
    // ------------------------------------------------------------
    renderBlogTab: function($stage) {
         const hasBlog = !!this.data.project.has_blog;
         
         $stage.html(`
            <div class="fco-dash-scroller">
                <div class="fco-dash-container">
                    <h2>Blog Configuration</h2>
                    <div class="fco-card">
                        <div class="fco-field-group">
                             <label class="fco-label">Enable Blog / News Section?</label>
                             <div class="fco-wiz-choicebar" style="justify-content:flex-start;">
                                <button type="button" class="fco-wiz-choice ${hasBlog ? 'active' : ''}" data-val="true">Yes</button>
                                <button type="button" class="fco-wiz-choice ${!hasBlog ? 'active' : ''}" data-val="false">No</button>
                             </div>
                        </div>
                    </div>
                    
                    <div id="dash-blog-cats-wrap" style="display:${hasBlog ? 'block' : 'none'};">
                        <h3>Blog Categories</h3>
                        <div class="fco-card">
                             <div class="fco-wiz-chipwrap">
                                  <input class="fco-input" id="dash-blog-cat-in" placeholder="Type category and press Enter...">
                                  <div class="fco-chiplist" id="dash-blog-cat-list"></div>
                             </div>
                        </div>
                    </div>
                </div>
            </div>
         `);
         
         $stage.find(".fco-wiz-choice").on("click", (e) => {
             const val = $(e.currentTarget).data("val");
             this.data.project.has_blog = val;
             $(e.currentTarget).siblings().removeClass("active");
             $(e.currentTarget).addClass("active");
             $("#dash-blog-cats-wrap").toggle(val);
             this.saveData(true);
         });
         
         this.renderChipsManager(this.data.branding, "blog_categories", "#dash-blog-cat-list", "#dash-blog-cat-in");
    },

    // ------------------------------------------------------------
    // TAB: SHOP
    // ------------------------------------------------------------
    renderShopTab: function($stage) {
         const hasShop = !!this.data.project.has_shop;
         
         $stage.html(`
            <div class="fco-dash-scroller">
                <div class="fco-dash-container">
                    <h2>Shop Configuration</h2>
                    <div class="fco-card">
                        <div class="fco-field-group">
                             <label class="fco-label">Enable Online Shop?</label>
                             <div class="fco-wiz-choicebar" style="justify-content:flex-start;">
                                <button type="button" class="fco-wiz-choice ${hasShop ? 'active' : ''}" data-val="true">Yes</button>
                                <button type="button" class="fco-wiz-choice ${!hasShop ? 'active' : ''}" data-val="false">No</button>
                             </div>
                        </div>
                    </div>
                    
                    <div id="dash-shop-cats-wrap" style="display:${hasShop ? 'block' : 'none'};">
                        <h3>Product Categories</h3>
                        <div class="fco-card">
                             <div class="fco-wiz-chipwrap">
                                  <input class="fco-input" id="dash-shop-cat-in" placeholder="Type category and press Enter...">
                                  <div class="fco-chiplist" id="dash-shop-cat-list"></div>
                             </div>
                        </div>
                    </div>
                </div>
            </div>
         `);
         
         $stage.find(".fco-wiz-choice").on("click", (e) => {
             const val = $(e.currentTarget).data("val");
             this.data.project.has_shop = val;
             $(e.currentTarget).siblings().removeClass("active");
             $(e.currentTarget).addClass("active");
             $("#dash-shop-cats-wrap").toggle(val);
             this.saveData(true);
         });
         
         this.renderChipsManager(this.data.branding, "shop_categories", "#dash-shop-cat-list", "#dash-shop-cat-in");
    },


    // ------------------------------------------------------------
    // DASHBOARD COMPONENT MANAGERS
    // ------------------------------------------------------------
    bindDataInputs: function($ctx) {
        $ctx.find(".bind-data").on("input", (e) => {
             const t = $(e.currentTarget).data("target");
             const parts = t.split(".");
             if(this.data[parts[0]]) this.data[parts[0]][parts[1]] = $(e.currentTarget).val();
             this.debouncedSave();
        });
    },

    renderUserListManager: function(targetId) {
        const list = this.data.project.wp_users;
        const html = list.map((u, i) => `
            <div class="fco-typo-row" style="margin-bottom:8px; display:flex; flex-wrap:wrap;">
                <input class="fco-input user-in" data-i="${i}" data-k="username" value="${this.escapeAttr(u.username)}" placeholder="Username" style="flex:1; min-width:120px;">
                <input class="fco-input user-in" data-i="${i}" data-k="first_name" value="${this.escapeAttr(u.first_name)}" placeholder="First Name" style="flex:1; min-width:120px;">
                <select class="fco-select user-in" data-i="${i}" data-k="role" style="flex:0 0 100px;">
                    <option value="administrator" ${u.role==='administrator'?'selected':''}>Admin</option>
                    <option value="editor" ${u.role==='editor'?'selected':''}>Editor</option>
                    <option value="author" ${u.role==='author'?'selected':''}>Author</option>
                </select>
                <button class="fco-mini danger user-del" data-i="${i}">×</button>
            </div>
        `).join("");
        $(targetId).html(html || '<div class="fco-wiz-hint">No users added.</div>');
        
        $(targetId).off("change input click").on("change input", ".user-in", (e) => {
             const el = $(e.currentTarget);
             list[el.data("i")][el.data("k")] = el.val();
             this.debouncedSave();
        }).on("click", ".user-del", (e) => {
             list.splice($(e.currentTarget).data("i"), 1);
             this.renderUserListManager(targetId);
             this.saveData(true);
        });
    },

    renderPaletteManager: function(targetId) {
          const colors = this.data.branding.colors;
          const render = () => {
            const strips = colors.map((c, i) => `
              <div class="fco-palette-strip" style="background:${this.escapeAttr(c.hex||'#fff')}">
                <div class="fco-strip-actions"><button class="fco-strip-del" data-i="${i}">×</button></div>
                <div class="fco-strip-inputs">
                  <input class="fco-strip-input" data-key="name" data-i="${i}" value="${this.escapeAttr(c.name)}" placeholder="Name">
                  <input class="fco-strip-input" data-key="hex" data-i="${i}" value="${this.escapeAttr(c.hex)}" placeholder="#Hex">
                </div>
              </div>
            `).join("");
            $(targetId).html(`
              <div class="fco-palette-stage" id="dash-palette-sortable">${strips}<div class="fco-add-strip" id="dash-add-col"><span class="fco-add-icon">+</span></div></div>
            `);
            
            if($.fn.sortable) {
                try { $("#dash-palette-sortable").sortable("destroy"); } catch(e){}
                $("#dash-palette-sortable").sortable({
                    items: ".fco-palette-strip", axis: "x", containment: "parent", tolerance: "pointer",
                    stop: (e, ui) => {
                       const newOrder = [];
                       $("#dash-palette-sortable .fco-palette-strip").each((idx, el) => {
                           const oldIndex = $(el).find(".fco-strip-input").first().data("i");
                           if(colors[oldIndex]) newOrder.push(colors[oldIndex]);
                       });
                       this.data.branding.colors = newOrder; this.saveData(true); render();
                    }
                });
            }
          };
          render();
          
          $(targetId).off("input click").on("input", ".fco-strip-input", (e) => {
            const el = $(e.currentTarget); const idx = el.data("i"); const key = el.data("key");
            if(colors[idx]) { 
                colors[idx][key] = el.val(); 
                if (key === "hex") el.closest(".fco-palette-strip").css("background", el.val()); 
                this.debouncedSave();
            }
          }).on("click", ".fco-strip-del", (e) => { 
              colors.splice($(e.currentTarget).data("i"), 1); render(); this.saveData(true); 
          }).on("click", "#dash-add-col", () => { 
              colors.push({ name: "New", hex: "#cccccc", pantone: "" }); render(); this.saveData(true); 
          });
    },

    renderTypoManager: function(targetId) {
        const fonts = this.data.branding.fonts;
        const render = () => {
             const html = fonts.map((f, i) => `
                <div class="fco-typo-row">
                    <div class="fco-typo-label">${this.escapeHtml(f.label)}</div>
                    <input class="fco-typo-input" data-i="${i}" value="${this.escapeAttr(f.name)}" placeholder="Google Font Name">
                    <button class="fco-btn ghost small typo-up" data-i="${i}">Upload</button>
                </div>
            `).join("");
            $(targetId).html(html);
        };
        render();
        
        $(targetId).off("input click").on("input", ".fco-typo-input", (e) => {
             fonts[$(e.currentTarget).data("i")].name = $(e.currentTarget).val();
             this.debouncedSave();
        }).on("click", ".typo-up", (e) => {
             const i = $(e.currentTarget).data("i");
             if(!wp.media) return;
             const frame = wp.media({ title: "Upload Font", button: {text:"Select"}, multiple: false });
             frame.on("select", () => {
                 const att = frame.state().get("selection").first().toJSON();
                 fonts[i].name = att.filename; fonts[i].url = att.url; render(); this.saveData(true);
             });
             frame.open();
        });
    },

    renderAssetManager: function(targetId) {
        const assets = this.data.branding.assets;
        const html = assets.map((a, i) => `
              <div class="fco-media-item"><img src="${this.escapeAttr(a.url)}"><button type="button" class="fco-media-x" data-i="${i}">×</button></div>
        `).join("");
        $(targetId).html(html);
        
        $(targetId).off("click").on("click", ".fco-media-x", (e) => {
             assets.splice($(e.currentTarget).data("i"), 1);
             this.renderAssetManager(targetId);
             this.saveData(true);
        });
    },
    
    renderInspirationManager: function(targetId) {
        const links = this.data.branding.inspiration_links;
        const html = links.map((lnk, i) => `<input class="fco-input insp-lnk" data-i="${i}" value="${this.escapeAttr(lnk)}" placeholder="https://" style="margin-bottom:8px;">`).join("");
        $(targetId).html(html);
        $(targetId).on("input", ".insp-lnk", (e) => {
            links[$(e.target).data("i")] = $(e.target).val();
            this.debouncedSave();
        });
    },

    renderStaffManager: function(targetId) {
        const list = this.data.content.staff;
        const render = () => {
            const html = list.map((m, i) => `
                <div class="fco-typo-row" style="margin-bottom:10px; grid-template-columns: 60px 1fr auto;">
                    <div class="staff-thumb" data-i="${i}">
                        ${m.image ? `<img src="${m.image}" style="width:100%; height:100%; object-fit:cover;">` : ''}
                        <div class="staff-overlay"><span class="dashicons dashicons-camera"></span></div>
                    </div>
                    <div style="display:grid; gap:5px;">
                        <input class="fco-input staff-in" data-i="${i}" data-k="name" value="${this.escapeAttr(m.name)}" placeholder="Name">
                        <input class="fco-input staff-in" data-i="${i}" data-k="position" value="${this.escapeAttr(m.position)}" placeholder="Position">
                        <textarea class="fco-input staff-in" data-i="${i}" data-k="bio" rows="2" placeholder="Short Bio">${this.escapeHtml(m.bio)}</textarea>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:5px;">
                        <button class="fco-mini danger staff-del" data-i="${i}">×</button>
                    </div>
                </div>
            `).join("");
            $(targetId).html(html);
        };
        render();

        $(targetId).off("click input").on("click", ".staff-del", (e) => { list.splice($(e.currentTarget).data("i"), 1); render(); this.saveData(true); });
        $(targetId).on("input", ".staff-in", (e) => {
            const el = $(e.currentTarget);
            list[el.data("i")][el.data("k")] = el.val();
            this.debouncedSave();
        });
        
        // Task 9: Click anywhere on thumb/overlay to upload
        $(targetId).on("click", ".staff-thumb", (e) => {
            const i = $(e.currentTarget).data("i");
            if(!wp.media) return;
            const frame = wp.media({ title: "Staff Photo", button: {text:"Select"}, multiple: false });
            frame.on("select", () => {
                const att = frame.state().get("selection").first().toJSON();
                list[i].image = att.url;
                render();
                this.saveData(true);
            });
            frame.open();
        });
    },

    renderChipsManager: function(dataObj, key, listId, inputId) {
        if (!Array.isArray(dataObj[key])) dataObj[key] = [];
        const arr = dataObj[key];
        
        const render = () => {
            const html = arr.map((x,i) => `<span class="fco-chip">${this.escapeHtml(x)}<button class="fco-chip-x" data-i="${i}">×</button></span>`).join("");
            $(listId).html(html || '<div class="fco-wiz-hint">None added.</div>');
        };
        render();
        
        $(inputId).off("keydown").on("keydown", (e) => {
            if(e.key === "Enter"){
                e.preventDefault();
                const v = $(e.target).val().trim();
                if(v){ arr.push(v); $(e.target).val(""); render(); this.saveData(true); }
            }
        });
        $(listId).off("click").on("click", ".fco-chip-x", (e) => {
            arr.splice($(e.currentTarget).data("i"), 1); render(); this.saveData(true);
        });
    },

    // ------------------------------------------------------------
    // NAV & PAGE LOGIC (FROM ORIGINAL)
    // ------------------------------------------------------------
    renderNav: function ({ enableDnD }) {
      const $list = $("#fco-nav-list");
      $list.empty();
      this.data.pages.sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const pages = this.data.pages.map(p => {
        const level = this.getLevel(p.id);
        const st = (this.data.drafts[p.id] || {}).status || "empty";
        return `
          <li class="fco-node" data-id="${this.escapeAttr(p.id)}" data-status="${this.escapeAttr(st)}" data-level="${level}">
            <div class="fco-node-inner" style="margin-left:${level * 34}px">
              <span class="fco-drag" aria-hidden="true">⋮⋮</span>
              <span class="fco-node-title" contenteditable="true" role="textbox" aria-label="Page title">${this.escapeHtml(p.title)}</span>
              <span class="fco-node-chip" aria-label="Status">${this.statusLabel(st)}</span>
              <div class="fco-node-actions">
                <button type="button" class="fco-mini" data-act="outdent">←</button>
                <button type="button" class="fco-mini" data-act="indent">→</button>
                <button type="button" class="fco-mini danger" data-act="delete">×</button>
              </div>
            </div>
          </li>
        `;
      }).join("");
      $list.html(pages || `<div class="fco-empty-msg">No pages yet. Add one to begin.</div>`);
      $list.find(".fco-node").on("click", (e) => {
        if ($(e.target).is('[contenteditable="true"]')) return;
        if ($(e.target).closest(".fco-node-actions").length) return;
        this.loadPageEditor($(e.currentTarget).data("id"));
      });
      $list.find(".fco-node-title").on("blur", (e) => {
        const id = $(e.currentTarget).closest(".fco-node").data("id");
        const p = this.data.pages.find(x => x.id === id);
        if (p) { p.title = $(e.currentTarget).text().trim() || "Untitled"; this.saveData(true); if (this.activeId === id) $("#fco-editor-container h1").first().text(p.title); }
      });
      $list.find(".fco-mini").on("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const act = $(e.currentTarget).data("act");
        const $btn = $(e.currentTarget).closest(".fco-node");
        const id = $btn.data("id");
        if (act === "delete") return this.deletePage(id);
        if (act === "indent") return this.indentPage(id);
        if (act === "outdent") return this.outdentPage(id);
      });
      if (enableDnD && $.fn.sortable) {
        try { $list.sortable("destroy"); } catch(e) {}
        $list.sortable({
          handle: ".fco-drag", placeholder: "fco-sort-placeholder", tolerance: "pointer",
          stop: (event, ui) => {
            const listLeft = $list.offset().left; const itemLeft = ui.offset.left; const dx = itemLeft - listLeft;
            let desired = Math.floor((dx - 40) / 40); desired = Math.max(0, Math.min(3, desired));
            const orderIds = []; $list.children(".fco-node").each((_, el) => orderIds.push($(el).data("id")));
            const newOrder = []; orderIds.forEach(id => { const p = this.data.pages.find(x => x.id === id); if (p) newOrder.push(p); });
            const levels = new Map(); newOrder.forEach(p => levels.set(p.id, this.getLevel(p.id)));
            const draggedId = ui.item.data("id"); const pos = newOrder.findIndex(p => p.id === draggedId);
            const prev = pos > 0 ? newOrder[pos - 1] : null; const prevLevel = prev ? (levels.get(prev.id) || 0) : 0;
            const maxAllowed = prev ? prevLevel + 1 : 0;
            levels.set(draggedId, Math.min(desired, maxAllowed));
            for (let i = 0; i < newOrder.length; i++) {
              const prevP = i > 0 ? newOrder[i - 1] : null;
              const prevL = prevP ? (levels.get(prevP.id) || 0) : 0;
              const maxL = prevP ? prevL + 1 : 0;
              const currId = newOrder[i].id;
              const currL = levels.get(currId) || 0;
              levels.set(currId, Math.min(currL, maxL));
            }
            const stack = [];
            newOrder.forEach((p, i) => {
              const lvl = levels.get(p.id) || 0;
              const parent = lvl === 0 ? null : (stack[lvl - 1] || null);
              p.parent = parent; p.sort = Date.now() + i;
              stack[lvl] = p.id; stack.length = lvl + 1;
            });
            this.saveData(true); this.renderNav({ enableDnD: true });
          }
        });
      }
      if (this.activeId) $list.find(`.fco-node[data-id="${this.cssEscape(this.activeId)}"]`).addClass("active");
    },
    
    // ... Page Tree Helpers ...
    getLevel: function (id) {
      let lvl = 0; let p = this.data.pages.find(x => x.id === id); const guard = new Set();
      while (p && p.parent && !guard.has(p.parent)) { guard.add(p.parent); lvl++; p = this.data.pages.find(x => x.id === p.parent); if (lvl > 6) break; }
      return Math.min(lvl, 3);
    },
    indentPage: function (id) {
      const list = this.data.pages.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const idx = list.findIndex(p => p.id === id);
      if (idx <= 0) return;
      const prev = list[idx - 1]; const currLevel = this.getLevel(id);
      if (currLevel >= 3) return;
      const p = this.data.pages.find(x => x.id === id);
      if (p) { p.parent = prev.id; p.sort = Date.now(); this.saveData(true); this.renderNav({ enableDnD: true }); }
    },
    outdentPage: function (id) {
      const p = this.data.pages.find(x => x.id === id); if (!p || !p.parent) return;
      const parent = this.data.pages.find(x => x.id === p.parent);
      p.parent = parent ? parent.parent : null; p.sort = Date.now(); this.saveData(true); this.renderNav({ enableDnD: true });
    },
    deletePage: function (id) {
      if (!confirm("Delete this page?")) return;
      const target = this.data.pages.find(x => x.id === id);
      const parentId = target ? target.parent : null;
      this.data.pages.forEach(p => { if (p.parent === id) p.parent = parentId || null; });
      this.data.pages = this.data.pages.filter(p => p.id !== id);
      delete this.data.drafts[id]; delete this.data.drafts[`${id}::main`];
      if (this.activeId === id) this.activeId = null;
      this.saveData(); this.renderNav({ enableDnD: true }); this.loadPageEditor(this.data.pages.length ? this.data.pages[0].id : null);
    },
    addPageInline: function () {
      const id = this.uid("p"); this.data.pages.push({ id, title: "New Page", parent: null, sort: Date.now() });
      if (!this.data.drafts[id]) this.data.drafts[id] = { status: "empty", goal: "", notes: "" };
      this.saveData(true); this.renderNav({ enableDnD: true });
      setTimeout(() => { const $node = $(`#fco-nav-list .fco-node[data-id="${this.cssEscape(id)}"] .fco-node-title`); if ($node.length) { $node.focus(); document.execCommand("selectAll", false, null); } }, 30);
    },
    statusLabel: function (s) { return s === "draft" ? "Draft" : (s === "review" ? "Review" : (s === "approved" ? "Done" : "Empty")); },

    loadPageEditor: function (id) {
      this.activeId = id;
      this.destroyWpEditor();
      this.renderNav({ enableDnD: (FCO_Config.isAdmin || !!FCO_Config.clientCanEditStructure) });
      const $container = $("#fco-editor-container");
      $container.empty();
      if (!id) { $container.html(`<div class="fco-empty"><div class="fco-empty-title">Select a page</div></div>`); $("#fco-aside-content").html(""); return; }
      const p = this.data.pages.find(x => x.id === id); if (!p) return;
      const contentKey = `${id}::main`;
      if (!this.data.drafts[contentKey]) this.data.drafts[contentKey] = { content: "" };
      if (!this.data.drafts[id]) this.data.drafts[id] = { status: "empty", goal: "", notes: "" };
      const draft = this.data.drafts[contentKey];
      const editorId = `fco_wp_editor_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      this.wpEditorId = editorId;
      
      const st = this.data.drafts[id].status || "empty";

      $container.html(`
        <div class="fco-editor-header" style="display:flex; justify-content:space-between; align-items:center;">
            <h1>${this.escapeHtml(p.title)}</h1>
            <select class="fco-select" id="header-status" style="width:auto;">
                <option value="empty" ${st === "empty" ? "selected" : ""}>Not started</option>
                <option value="draft" ${st === "draft" ? "selected" : ""}>Drafting</option>
                <option value="review" ${st === "review" ? "selected" : ""}>Review</option>
                <option value="approved" ${st === "approved" ? "selected" : ""}>Approved</option>
            </select>
        </div>
        <div class="fco-field-grid">
          <div class="fco-field-group"><label class="fco-label">Page purpose</label><input type="text" class="fco-input" id="page-goal" value="${this.escapeAttr(this.data.drafts[id].goal || "")}"></div>
        </div>
        <div class="fco-split-stage">
            <div class="fco-wiz-rich">
                <div class="fco-wiz-hint" style="text-align:left; margin-bottom:10px;">Page Content</div>
                <textarea id="${this.escapeAttr(editorId)}">${this.escapeHtml(draft.content || "")}</textarea>
            </div>
            <div class="fco-wiz-rich" style="padding:15px;">
                <div class="fco-label" style="text-align:left;">Page Images / References</div>
                <div class="fco-media-grid" id="editor-page-imgs"></div>
                <button class="fco-btn ghost small" id="editor-add-img" style="margin-top:10px;">+ Add Images</button>
            </div>
        </div>
        
        <!-- NEW: Comments Section (Below Editor) -->
        <div class="fco-comments-section">
            <div class="fco-comments-toggle" id="comments-toggle">
                <span>View Discussion</span>
                <span id="comment-count" style="background:#e2e8f0; padding:2px 8px; border-radius:99px; font-size:0.8rem;">
                    ${(this.data.comments[id] || []).length}
                </span>
            </div>
            <div class="fco-comments-body" id="comments-body">
                <div id="fco-comments-list" style="max-height:300px; overflow-y:auto; margin-bottom:15px;"></div>
                <textarea class="fco-input" id="new-comment-text" rows="2" placeholder="Write a comment..." style="margin-bottom:10px;"></textarea>
                <button class="fco-btn primary small" id="add-comment-btn">Post Comment</button>
            </div>
        </div>
      `);
      
      $("#header-status").on("change", (e) => { 
          this.data.drafts[id].status = $(e.target).val(); 
          this.saveData(); 
          this.renderNav({ enableDnD: true }); 
      });
      
      $("#page-goal").on("input", (e) => { this.data.drafts[id].goal = $(e.target).val(); if (this.data.drafts[id].status === "empty") this.data.drafts[id].status = "draft"; this.debouncedSave(); });
      this.initWpEditor(editorId, { onChange: (newHtml) => { this.data.drafts[contentKey].content = newHtml; if (this.data.drafts[id].status === "empty") this.data.drafts[id].status = "draft"; this.debouncedSave(); } });
      if (!Array.isArray(this.data.drafts[id].images)) this.data.drafts[id].images = [];
      const renderEditorImages = () => {
         const imgs = this.data.drafts[id].images;
         $("#editor-page-imgs").html(imgs.map((img, i) => `<div class="fco-media-item"><img src="${img.url}"><button class="fco-media-x" data-i="${i}">×</button></div>`).join(""));
      };
      renderEditorImages();
      $("#editor-add-img").on("click", () => {
         const frame = wp.media({ multiple: true });
         frame.on("select", () => { const selection = frame.state().get("selection"); selection.map(att => this.data.drafts[id].images.push({ id: att.id, url: att.attributes.url })); renderEditorImages(); this.saveData(true); });
         frame.open();
      });
      $container.on("click", ".fco-media-x", (e) => { this.data.drafts[id].images.splice($(e.currentTarget).data("i"), 1); renderEditorImages(); this.saveData(true); });
      
      // Comments Logic
      this.initComments(id);
    },

    initComments: function(id) {
        if (!Array.isArray(this.data.comments[id])) this.data.comments[id] = [];
        const comments = this.data.comments[id];
        
        const renderList = () => {
            const listHtml = comments.map((c, i) => `
                <div class="fco-comment-item">
                    <div style="font-size:0.75rem; color:#64748b; display:flex; justify-content:space-between; margin-bottom:4px;">
                        <strong>${this.escapeHtml(c.author)}</strong>
                        <span>${this.escapeHtml(c.date)}</span>
                    </div>
                    <div style="font-size:0.95rem; color:#334155; white-space:pre-wrap; line-height:1.4;">${this.escapeHtml(c.text)}</div>
                </div>
            `).join("");
            $("#fco-comments-list").html(listHtml || '<div class="fco-empty-msg">No comments yet. be the first!</div>');
            $("#comment-count").text(comments.length);
        };
        
        renderList();
        
        $("#comments-toggle").on("click", () => {
            $("#comments-body").toggleClass("open");
        });
        
        $("#add-comment-btn").on("click", () => {
            const txt = $("#new-comment-text").val().trim();
            if(!txt) return;
            
            const now = new Date();
            const dateStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            comments.unshift({
                author: FCO_Config.user.name || "User",
                date: dateStr,
                text: txt
            });
            
            $("#new-comment-text").val("");
            renderList();
            this.saveData(true);
        });
    },

    // ------------------------------------------------------------
    // WIZARD RENDER (RETAINED FROM V16)
    // ------------------------------------------------------------
    renderWizard: function ($el) {
       // ... Wizard logic remains identical to v16, ensuring smooth onboarding ...
       // For brevity in this specific file replacement, I'm ensuring it calls the existing structure.
       // The V16 Wizard logic is large. I will include the critical parts to ensure it works.
       // NOTE: Since I am replacing the file entirely, I must include the Wizard code.
       
      const name = (FCO_Config.user && FCO_Config.user.name) ? FCO_Config.user.name : "there";
      const isAdmin = !!FCO_Config.isAdmin;
      // HARDCODED LOGO PATH (Wizard)
      const logoUrl = "/wp-content/plugins/foundation-content-onboard/assets/Inkfirelogo.png";
      
      // UX OPTIMIZATION VARIABLES
      let navLocked = false;
      let typingToken = 0;
      
      // TYPEWRITER CONSTANTS
      const TYPE_MIN_MS = 12;      // fastest per char
      const TYPE_MAX_MS = 28;      // slowest per char
      const TYPE_BASE_MS = 18;     // normal
      const TYPE_PUNCT_BONUS = 120; // pause on punctuation
      const TYPE_NEWLINE_BONUS = 160;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      let steps = [
        { id: "intro", type: "intro", title: "Content Onboarding", text: `Hey ${name}. Let’s get your website ready.` },
        { id: "site_name", type: "text", title: "Site Name", text: "What’s your website called?", target: "branding.company_name", placeholder: "e.g. Inkfire Limited" },
        { id: "admin_setup", type: "admin_setup", title: "Admin Details", text: "Key details for your site setup." },
        { id: "tagline", type: "text", title: "Tagline", text: "Do you have a tagline? (Optional)", target: "branding.tagline", placeholder: "e.g. Digital made simple." },
        { id: "one_liner", type: "textarea", title: "One-liner", text: "A short sentence describing what you or your business does (shown in the footer).", target: "branding.one_liner", placeholder: "We help brands scale..." },
        { id: "contact_info", type: "contact_info", title: "Contact Info", text: "Where can customers find you? Add multiple emails/phones if needed." },
        { id: "socials", type: "socials_manager", title: "Social Media", text: "Add links to your social profiles." },
        { id: "logos", type: "media_multiple", title: "Brand Assets", text: "Upload your logo, icon, and other brand files.", target: "branding.assets" },
        { id: "brand_colours", type: "brand_colours_pantone", title: "Palette Studio", text: "Build your palette. Hover to expand strips.", target: "branding.colors" },
        { id: "typography", type: "typography_selector", title: "Typography", text: "Choose up to 4 fonts. Type a Google Font name or upload a file.", target: "branding.fonts" },
        { id: "inspiration", type: "inspiration", title: "Design Inspiration", text: "Help us understand your style. Share websites you like and upload guidelines." },
        { id: "brand_summary", type: "brand_summary", title: "Brand Identity", text: "Review your brand details so far, then click next" },
        { id: "blog_toggle", type: "choice", title: "Blog / News", text: "Do you want a blog or news section?", target: "project.has_blog", options: [ { label: "Yes, I need a blog", value: true }, { label: "No, not right now", value: false } ]},
        { id: "blog_cats", type: "chips", title: "Blog Categories", text: "What topics will you cover?", target: "branding.blog_categories", when: () => !!this.data.project.has_blog, placeholder: "Type a category and press Enter..." },
        { id: "shop_toggle", type: "choice", title: "Online Store", text: "Do you plan to sell products online?", target: "project.has_shop", options: [ { label: "Yes, create a shop", value: true }, { label: "No, just a brochure site", value: false } ]},
        { id: "shop_cats", type: "chips", title: "Product Categories", text: "What types of products do you sell?", target: "branding.shop_categories", when: () => !!this.data.project.has_shop, placeholder: "e.g. T-Shirts, Mugs..." },
        { id: "staff_roster", type: "staff_manager", title: "Our Team", text: "Add staff members for your 'Team' page." },
        { id: "wp_users", type: "user_manager", title: "WordPress Users", text: "Who needs a login to the new website?" },
        { id: "pages", type: "page_builder", title: "Sitemap", text: "Let's plan your pages. Drag to reorder or nest.", target: "pages.structure" },
        { id: "build_page_steps", type: "build_page_steps", title: "Content", text: "Let's create your webpage content. (Tip: you can save and come back at anytime)", target: null },
        { id: "outro", type: "outro", title: "All Done", text: "Great work. Setting up your dashboard now." }
      ];

      let idx = 0;

      $el.html(`
        <div class="fco-wizard-stage" role="region" aria-label="Content onboarding wizard">
          <div class="fco-wizard-card">
            <div class="fco-wizard-topbar">
              <div class="fco-wizard-brand">
                <div class="fco-logo-mark" aria-hidden="true">
                    <img src="${logoUrl}" alt="Inkfire logo" style="width:100%; height:100%; object-fit:contain; border-radius:inherit;">
                </div>
                <div class="fco-wizard-brandtext">
                  <div class="fco-wizard-title">Inkfire Foundation</div>
                  <div class="fco-wizard-sub">Content Manager</div>
                </div>
              </div>
              <div class="fco-wizard-top-actions">
                <button class="fco-btn ghost small" id="wiz-save-now">Save</button>
                <button class="fco-btn ghost small" id="wiz-exit">Exit</button>
              </div>
            </div>
            <div class="fco-wizard-progress" aria-hidden="true">
              <div class="fill" style="width:0%"></div>
            </div>
            <div class="fco-wizard-body">
              <div class="fco-wizard-stepmeta" id="wiz-stepmeta"></div>
              <div class="fco-wizard-question" id="wiz-question" aria-live="polite"></div>
              <div class="fco-wizard-input" id="wiz-input"></div>
            </div>
            <div class="fco-wizard-footer">
              <button class="fco-btn ghost" id="wiz-back" type="button">Back</button>
              <div class="fco-wiz-footnote">Your answers autosave.</div>
              <button class="fco-btn primary" id="wiz-next" type="button">Next <span aria-hidden="true">→</span></button>
            </div>
          </div>
        </div>
      `);

      const $q = $("#wiz-question");
      const $input = $("#wiz-input");
      const $meta = $("#wiz-stepmeta");
      const $fill = $(".fco-wizard-progress .fill");
      // Cache buttons for performance
      const $next = $("#wiz-next");
      const $back = $("#wiz-back");

      // Wizard Nav Logic
      $("#wiz-exit").on("click", () => this.switchMode("editor"));
      $("#wiz-save-now").on("click", () => {
          this.saveData(false); // Force save (false = show 'Saving...')
          setTimeout(() => alert("Progress saved."), 500);
      });

      const visibleSteps = () => steps.filter(s => !s.when || s.when());
      const stepCount = () => visibleSteps().length;
      const currentStep = () => visibleSteps()[idx];

      const updateProgress = () => {
        const total = stepCount();
        const pct = total <= 1 ? 0 : Math.round((idx / (total - 1)) * 100);
        $fill.css("width", `${pct}%`);
      };

      const setNavState = () => {
        $back.prop("disabled", idx <= 0);
        const s = currentStep();
        const isLast = idx >= (stepCount() - 1);
        let btnText = "Next";
        if (s.type === "intro") btnText = "Get Started";
        else if (isLast || s.type === "outro") btnText = "Finish";
        $next.html(`${btnText} <span aria-hidden="true">→</span>`);
      };

      const typewriter = async (text) => {
          const myToken = ++typingToken;
          $q.attr("data-typing", "1");
        
          // Clear first
          $q.text("");
        
          // If user prefers reduced motion, skip typing entirely
          const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (reduceMotion) {
            $q.text(text);
            $q.removeAttr("data-typing");
            return;
          }
        
          // Clamp speed a little based on length (longer text slightly faster)
          const len = text.length || 1;
          const speed = Math.max(TYPE_MIN_MS, Math.min(TYPE_MAX_MS, TYPE_BASE_MS - Math.floor(len / 250)));
        
          for (let i = 0; i < text.length; i++) {
            if (typingToken !== myToken) break; // cancelled
            const ch = text[i];
            $q.append(document.createTextNode(ch));
        
            let extra = 0;
            if (ch === "\n") extra += TYPE_NEWLINE_BONUS;
            if (/[.!?]/.test(ch)) extra += TYPE_PUNCT_BONUS;
        
            await sleep(speed + extra);
          }
        
          $q.removeAttr("data-typing");
      };
      
      const finishTypingNow = (s) => {
          // Cancel current typewriter loop
          typingToken++;
          $q.removeAttr("data-typing");
        
          // If we have the step, instantly show full text
          if (s && s.text) $q.text(s.text);
      };
      
      const getValueByTarget = (target) => {
        if (!target) return null;
        const parts = target.split(".");
        if (this.data[parts[0]]) return this.data[parts[0]][parts[1]];
        return null;
      };

      const setValueByTarget = (target, val) => {
        if (!target) return;
        const parts = target.split(".");
        if (this.data[parts[0]]) this.data[parts[0]][parts[1]] = val;
      };

      // Reuse the components for wizard inputs (copied logic for stability)
      const renderInputForStep = (s) => {
        $input.empty();
        this.destroyWpEditor();
        this.lastWizardRenderKey = `${s.id}::${idx}`;

        if (s.type === "intro") { $input.html(`<div class="fco-wiz-hint">Click <strong>Get Started</strong> to begin.</div>`); return; }
        if (s.type === "outro") { $input.html(`<div class="fco-wiz-hint">Click <strong>Finish</strong> to open your dashboard.</div>`); return; }
        
        // --- FIX FOR AUTOFILL & REUSED IDS ---
        if (s.type === "text" || s.type === "textarea") {
          const v = getValueByTarget(s.target) || "";
          const fieldId = `wiz-field-${s.id}`;
          
          // Added autocomplete attributes to prevent junk fill
          const commonAttrs = `id="${fieldId}" name="${fieldId}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true"`;

          const field = s.type === "textarea" 
            ? `<textarea class="fco-wiz-field" ${commonAttrs} rows="4" placeholder="${this.escapeAttr(s.placeholder || "")}">${this.escapeHtml(v)}</textarea>`
            : `<input class="fco-wiz-field" ${commonAttrs} type="text" value="${this.escapeHtml(v)}" placeholder="${this.escapeAttr(s.placeholder || "")}">`;
          
          $input.html(`<div class="fco-wiz-fieldrow">${field}</div>`);
          
          // Focus the unique ID and bind with delegation on $input
          $input.find(`#${fieldId}`).focus();
          $input.off("keydown", `#${fieldId}`).on("keydown", `#${fieldId}`, (e) => { 
             if (e.key === "Enter" && s.type !== "textarea") { 
                 e.preventDefault(); 
                 $next.click(); 
             } 
          });
          return;
        }
        
        if(s.type === "admin_setup") {
            const p = this.data.project;
            $input.html(`<div class="fco-wiz-fieldrow" style="flex-direction:column; gap:20px;"><input class="fco-wiz-field" id="wiz-adm-email" value="${this.escapeAttr(p.admin_email)}" placeholder="Admin Email Address"><input class="fco-wiz-field" id="wiz-adm-web" value="${this.escapeAttr(p.existing_website)}" placeholder="Existing Website URL (if any)"></div>`);
            $("#wiz-adm-email").focus();
            return;
        }

        // Contact Info, Socials, Staff, User Manager, Media Multiple, Brand Colours, Typo Selector
        // These are complex. To keep this file replacement valid, I am pasting the V16 logic here.
        if (s.type === "contact_info") {
            const c = this.data.branding.contact;
            // Updated for Task 3: Grid Layout
            $input.html(`
                <div class="fco-wiz-contact-grid">
                    <div class="fco-field-group">
                        <label class="fco-label">Business Address</label>
                        <textarea class="fco-wiz-field" id="wiz-c-addr" style="min-height:100px; font-size:1.1rem;" placeholder="Full Address">${this.escapeHtml(c.address)}</textarea>
                    </div>
                    <div class="fco-field-group">
                        <label class="fco-label">Email Addresses (Type & Enter)</label>
                        <div class="fco-wiz-chipwrap"><input class="fco-input" id="wiz-c-email" placeholder="sales@example.com"><div class="fco-chiplist" id="wiz-list-email"></div></div>
                    </div>
                    <div class="fco-field-group">
                        <label class="fco-label">Phone Numbers (Type & Enter)</label>
                        <div class="fco-wiz-chipwrap"><input class="fco-input" id="wiz-c-phone" placeholder="+1 555 0123"><div class="fco-chiplist" id="wiz-list-phone"></div></div>
                    </div>
                </div>
            `);
            // Delegated binding
            $input.off("input", "#wiz-c-addr").on("input", "#wiz-c-addr", (e) => { c.address = $(e.target).val(); this.debouncedSave(); });
            const bindChips = (arr, inputId, listId) => {
                const render = () => { $input.find(`#${listId}`).html(arr.map((x,i) => `<span class="fco-chip">${this.escapeHtml(x)}<button class="fco-chip-x" data-i="${i}">×</button></span>`).join("")); };
                render();
                $input.off("keydown", `#${inputId}`).on("keydown", `#${inputId}`, (e) => { 
                    if(e.key === "Enter"){ 
                        e.preventDefault(); 
                        const v = $(e.target).val().trim(); 
                        if(v){ arr.push(v); $(e.target).val(""); render(); this.debouncedSave(); } 
                    } 
                });
                $input.off("click", `#${listId} .fco-chip-x`).on("click", `#${listId} .fco-chip-x`, (e) => { arr.splice($(e.currentTarget).data("i"), 1); render(); this.debouncedSave(); });
            };
            bindChips(c.emails, "wiz-c-email", "wiz-list-email"); bindChips(c.phones, "wiz-c-phone", "wiz-list-phone");
            return;
        }

        if (s.type === "socials_manager") {
            // Updated for Task 4: Grid Layout
            const list = this.data.branding.socials;
            const render = () => {
                const html = list.map((soc, i) => `<div class="fco-typo-row"><input class="fco-typo-input" placeholder="Platform" value="${this.escapeAttr(soc.platform)}" data-i="${i}" data-k="platform" style="flex:0 0 40%;"><input class="fco-typo-input" placeholder="URL" value="${this.escapeAttr(soc.url)}" data-i="${i}" data-k="url" style="flex:1;"><button class="fco-mini danger del-soc" data-i="${i}">×</button></div>`).join("");
                $("#wiz-soc-list").html(html);
            };
            $input.html(`<div class="fco-wiz-socials-grid" style="width:100%;"><div id="wiz-soc-list"></div><button class="fco-btn ghost small full" id="wiz-add-soc" style="margin-top:10px;">+ Add Social Profile</button></div>`);
            render();
            // Delegated binding
            $input.off("click", "#wiz-add-soc").on("click", "#wiz-add-soc", () => { list.push({platform:"", url:""}); render(); });
            $input.off("click", ".del-soc").on("click", ".del-soc", (e) => { list.splice($(e.currentTarget).data("i"), 1); render(); });
            $input.off("input", ".fco-typo-input").on("input", ".fco-typo-input", (e) => { const el = $(e.currentTarget); list[el.data("i")][el.data("k")] = el.val(); this.debouncedSave(); });
            return;
        }

        // Delegate to new Dashboard renderers where appropriate to save code, but Wizard needs custom wrapping.
        // For safety, I will keep the V16 Wizard logic intact.
        if (s.type === "inspiration") {
            // Updated for Task 6: Inspiration Grid
            const b = this.data.branding;
            if(!b.inspiration_links || b.inspiration_links.length < 6) b.inspiration_links = ["", "", "", "", "", ""];
            
            $input.html(`
                <div style="width:100%;">
                    <div class="fco-label">Top 6 Inspiration Websites</div>
                    <div class="fco-wiz-insp-grid">
                        ${b.inspiration_links.map((lnk, i) => `<input class="fco-input insp-lnk" data-i="${i}" value="${this.escapeAttr(lnk)}" placeholder="https://">`).join("")}
                    </div>
                    <div class="fco-label">Design brief</div>
                    <textarea class="fco-input" id="wiz-style-notes" rows="4" placeholder="Describe the style you want (e.g. Minimal, dark mode, playful)..." style="width:100%; margin-bottom:20px;">${this.escapeHtml(b.style_notes||"")}</textarea>
                    <div style="border-top:1px solid #e2e8f0; padding-top:20px;">
                        <div class="fco-label">Brand Guidelines / Style Guide (PDF)</div>
                        <div id="wiz-brand-doc-preview" style="margin-bottom:10px; font-weight:600; color:#4f46e5;">${b.brand_doc ? b.brand_doc.filename : "No file uploaded"}</div>
                        <button class="fco-btn ghost small" id="wiz-up-doc">Upload Document</button>
                    </div>
                </div>
            `);
            // Delegated binding
            $input.off("input", ".insp-lnk").on("input", ".insp-lnk", (e) => { b.inspiration_links[$(e.target).data("i")] = $(e.target).val(); this.debouncedSave(); });
            $input.off("input", "#wiz-style-notes").on("input", "#wiz-style-notes", (e) => { b.style_notes = $(e.target).val(); this.debouncedSave(); });
            $input.off("click", "#wiz-up-doc").on("click", "#wiz-up-doc", () => { if(!wp.media) return; const frame = wp.media({ title: "Upload Brand Doc", button: {text:"Select"}, multiple: false }); frame.on("select", () => { const att = frame.state().get("selection").first().toJSON(); b.brand_doc = { id: att.id, url: att.url, filename: att.filename }; $("#wiz-brand-doc-preview").text(att.filename); this.saveData(true); }); frame.open(); });
            return;
        }

        if (s.type === "staff_manager") {
             $input.html(`<div style="width:100%; max-width:800px;"><div id="wiz-staff-list"></div><button class="fco-btn primary full" id="wiz-add-staff">+ Add Staff Member</button></div>`);
             this.renderStaffManager("#wiz-staff-list");
             $input.off("click", "#wiz-add-staff").on("click", "#wiz-add-staff", () => { this.data.content.staff.push({name:"", position:"", bio:"", image:""}); this.renderStaffManager("#wiz-staff-list"); });
             return;
        }

        if (s.type === "user_manager") {
            $input.html(`<div style="width:100%; max-width:900px;"><div id="wiz-user-list"></div><button class="fco-btn primary full" id="wiz-add-user">+ Add User</button></div>`);
            this.renderUserListManager("#wiz-user-list");
            $input.off("click", "#wiz-add-user").on("click", "#wiz-add-user", () => { this.data.project.wp_users.push({username:"", first_name:"", last_name:"", role:"editor"}); this.renderUserListManager("#wiz-user-list"); });
            return;
        }
        
        if (s.type === "choice") {
          const curr = getValueByTarget(s.target);
          const btns = (s.options || []).map(o => `<button type="button" class="fco-wiz-choice ${curr === o.value ? "active" : ""}" data-val="${String(o.value)}">${this.escapeHtml(o.label)}</button>`).join("");
          $input.html(`<div class="fco-wiz-choicebar" role="group" aria-label="Choose one">${btns}</div>`);
          $input.find(".fco-wiz-choice").on("click", (e) => { $input.find(".fco-wiz-choice").removeClass("active"); $(e.currentTarget).addClass("active"); });
          return;
        }
        
        if (s.type === "chips") {
            // Re-use logic but adapted for wizard state
            const existing = Array.isArray(getValueByTarget(s.target)) ? getValueByTarget(s.target) : [];
            const renderChips = () => { $("#wiz-chiplist").html(existing.map((c, i) => `<span class="fco-chip">${this.escapeHtml(c)}<button type="button" class="fco-chip-x" data-i="${i}">×</button></span>`).join("") || `<div class="fco-wiz-hint">Nothing added yet.</div>`); };
            $input.html(`<div class="fco-wiz-chipwrap"><div class="fco-wiz-fieldrow"><input class="fco-wiz-field" id="wiz-chipin" type="text" placeholder="${this.escapeAttr(s.placeholder)}" /></div><div class="fco-chiplist" id="wiz-chiplist"></div></div>`);
            renderChips();
            $input.off("keydown", "#wiz-chipin").on("keydown", "#wiz-chipin", (e) => { if (e.key === "Enter") { e.preventDefault(); const v = String($(e.target).val()||"").trim(); if (v) { existing.push(v); $(e.target).val(""); renderChips(); } } });
            $input.off("click", ".fco-chip-x").on("click", ".fco-chip-x", (e) => { existing.splice($(e.currentTarget).data("i"), 1); renderChips(); });
            this.wizardState[s.target] = existing;
            return;
        }
        
        if (s.type === "media_multiple") {
            $input.html(`<div class="fco-wiz-media"><div class="fco-media-grid" id="wiz-mediagrid"></div><button type="button" class="fco-btn primary" id="wiz-upload">+ Add Files</button></div>`);
            this.renderAssetManager("#wiz-mediagrid");
            $input.off("click", "#wiz-upload").on("click", "#wiz-upload", () => {
                if (!window.wp || !wp.media) return;
                const frame = wp.media({ title: "Select Branding", button: {text:"Add"}, multiple: true });
                frame.on("select", () => {
                  const selection = frame.state().get("selection");
                  selection.map(att => { const json = att.toJSON(); this.data.branding.assets.push({ id: json.id, url: json.url }); });
                  this.renderAssetManager("#wiz-mediagrid"); this.saveData(true);
                });
                frame.open();
            });
            return;
        }

        if (s.type === "brand_colours_pantone") {
             // Task 5: Width Fix
             $input.html(`<div id="wiz-palette-wrap"></div>`);
             this.renderPaletteManager("#wiz-palette-wrap");
             return;
        }
        
        if (s.type === "typography_selector") {
             $input.html(`<div class="fco-typo-grid" id="wiz-typo-wrap"></div>`);
             this.renderTypoManager("#wiz-typo-wrap");
             return;
        }

        if (s.type === "brand_summary") {
          const b = this.data.branding;
          const logo = (b.assets && b.assets.length > 0) ? `<img src="${b.assets[0].url}" style="max-height:80px; object-fit:contain;">` : `<div style="color:#94a3b8; font-style:italic;">No Logo Uploaded</div>`;
          const fontsHtml = (b.fonts || []).filter(f=>f.name).map(f => `<div class="fco-summary-font-row"><strong style="color:#0f172a;">${f.label}:</strong> ${f.name}</div>`).join("");
          const colorsHtml = (b.colors||[]).map(c => `<div class="fco-summary-color-strip" style="background:${c.hex};" title="${c.name} - ${c.hex}"></div>`).join("");

          // Redesigned Grid Layout
          $input.html(`
            <div class="fco-summary-grid">
                <div class="fco-summary-col-colors">
                    ${colorsHtml}
                </div>
                <div class="fco-summary-details">
                    <div>
                        <h1 class="fco-summary-h1">${this.escapeHtml(b.company_name || "Company Name")}</h1>
                        <div class="fco-summary-tag">${this.escapeHtml(b.tagline || "")}</div>
                    </div>
                    <div class="fco-summary-section">
                        <div class="fco-summary-label">Brand Mark</div>
                        <div>${logo}</div>
                    </div>
                    <div class="fco-summary-section">
                        <div class="fco-summary-label">Typography</div>
                        ${fontsHtml || '<div style="color:#94a3b8;">No fonts selected</div>'}
                    </div>
                </div>
            </div>
          `);
          return;
        }

        if (s.type === "page_builder") {
          if (!Array.isArray(this.wizardState.pages)) { this.wizardState.pages = [ { id: this.uid("p"), title: "Home", level: 0 }, { id: this.uid("p"), title: "Contact", level: 0 } ]; }
          const renderList = () => {
            const items = this.wizardState.pages.map(p => `<li class="fco-pageitem" data-id="${this.escapeAttr(p.id)}" data-level="${p.level}"><div class="fco-pageitem-inner" style="margin-left:${p.level * 20}px"><span class="fco-drag" aria-hidden="true">⋮⋮</span><span class="fco-title" contenteditable="true" role="textbox">${this.escapeHtml(p.title)}</span><div class="fco-pageactions"><button type="button" class="fco-mini" data-act="outdent">←</button><button type="button" class="fco-mini" data-act="indent">→</button><button type="button" class="fco-mini danger" data-act="delete">×</button></div></div></li>`).join("");
            $("#wiz-pages").html(items || `<div class="fco-wiz-hint">Add at least one page.</div>`);
            $("#wiz-pages .fco-title").off("input").on("input", (e) => { const id = $(e.currentTarget).closest(".fco-pageitem").data("id"); const page = this.wizardState.pages.find(x => x.id === id); if(page) page.title = $(e.currentTarget).text().trim() || "Untitled"; });
            $("#wiz-pages .fco-mini").off("click").on("click", (e) => {
               const act = $(e.currentTarget).data("act"); const id = $(e.currentTarget).closest(".fco-pageitem").data("id"); const i = this.wizardState.pages.findIndex(x => x.id === id); if(i<0) return;
               if(act==="delete") { this.wizardState.pages.splice(i, 1); renderList(); return; }
               if(act==="indent" && i>0) { this.wizardState.pages[i].level = Math.min(3, this.wizardState.pages[i-1].level+1); renderList(); }
               if(act==="outdent") { this.wizardState.pages[i].level = Math.max(0, this.wizardState.pages[i].level-1); renderList(); }
            });
            if ($.fn.sortable) { try { $("#wiz-pages").sortable("destroy"); } catch(e){} $("#wiz-pages").sortable({ handle: ".fco-drag", stop: (e, ui) => { const newOrder = []; $("#wiz-pages").children(".fco-pageitem").each((_, li) => { const id = $(li).data("id"); const found = this.wizardState.pages.find(x => x.id === id); if(found) newOrder.push(found); }); this.wizardState.pages = newOrder; } }); }
          };
          $input.html(`<div class="fco-pagebuilder"><div class="fco-pageadd"><input class="fco-wiz-field" id="wiz-pagein" type="text" placeholder="Type page name (e.g. Services)" autocomplete="off" /><button type="button" class="fco-btn primary" id="wiz-addpage">Add</button></div><ul class="fco-pagelist" id="wiz-pages"></ul></div>`);
          const addPageFromInput = () => { const v = String($("#wiz-pagein").val() || "").trim(); if (!v) return; this.wizardState.pages.push({ id: this.uid("p"), title: v, level: 0 }); $("#wiz-pagein").val(""); renderList(); };
          $input.off("click", "#wiz-addpage").on("click", "#wiz-addpage", addPageFromInput); 
          $input.off("keydown", "#wiz-pagein").on("keydown", "#wiz-pagein", (e) => { if (e.key === "Enter") { e.preventDefault(); addPageFromInput(); } }); 
          renderList();
          return;
        }
        
        if (s.type === "rich_wizard") {
          // Task 10: Rich Wizard Width Fix
          const pageId = s.pageId; const contentKey = `${pageId}::main`;
          if (!this.data.drafts[contentKey]) this.data.drafts[contentKey] = { content: "" };
          if (!this.data.drafts[pageId]) this.data.drafts[pageId] = {};
          if (!Array.isArray(this.data.drafts[pageId].images)) this.data.drafts[pageId].images = [];
          const html = this.data.drafts[contentKey].content || "";
          $input.html(`<div class="fco-wiz-rich-container"><div class="fco-split-stage"><div class="fco-wiz-rich"><div class="fco-wiz-hint" style="text-align:left; margin-bottom:10px;">Page Content</div><textarea id="wiz-rich-area" class="fco-wiz-richarea">${this.escapeHtml(html)}</textarea></div><div class="fco-wiz-rich"><div class="fco-label" style="text-align:left;">Page Images / References</div><div class="fco-media-grid" id="wiz-page-imgs"></div><button class="fco-btn ghost small" id="wiz-add-img" style="margin-top:10px;">+ Add Images</button></div></div></div>`);
          this.initWpEditor("wiz-rich-area", { onChange: (newHtml) => { this.data.drafts[contentKey].content = newHtml; this.debouncedSave(); } });
          const renderPageImages = () => { const imgs = this.data.drafts[pageId].images; $("#wiz-page-imgs").html(imgs.map((img, i) => `<div class="fco-media-item"><img src="${img.url}"><button class="fco-media-x" data-i="${i}">×</button></div>`).join("")); };
          renderPageImages();
          $input.off("click", "#wiz-add-img").on("click", "#wiz-add-img", () => { const frame = wp.media({ multiple: true }); frame.on("select", () => { const selection = frame.state().get("selection"); selection.map(att => this.data.drafts[pageId].images.push({ id: att.id, url: att.attributes.url })); renderPageImages(); this.saveData(true); }); frame.open(); });
          $input.off("click", "#wiz-page-imgs .fco-media-x").on("click", "#wiz-page-imgs .fco-media-x", (e) => { this.data.drafts[pageId].images.splice($(e.currentTarget).data("i"), 1); renderPageImages(); this.saveData(true); });
          return;
        }

        if (s.type === "build_page_steps") {
           this.syncWizardPagesToData();
           const perPageSteps = [];
           this.data.pages.forEach(p => { perPageSteps.push({ id: `pg_content_${p.id}`, type: "rich_wizard", title: p.title, text: `Draft content and images for ${p.title} page.`, pageId: p.id }); });
           const insertAt = steps.findIndex(x => x.id === "build_page_steps");
           if (insertAt >= 0) steps.splice(insertAt + 1, 0, ...perPageSteps);
           setTimeout(() => { $next.click(); }, 100);
           return;
        }
      };

      const mapWizardStepValueToData = (s) => {
        if (!s.target) return;
        if (s.type === "admin_setup") { this.data.project.admin_email = $("#wiz-adm-email").val(); this.data.project.existing_website = $("#wiz-adm-web").val(); return; }
        if (s.type === "chips") { setValueByTarget(s.target, this.wizardState[s.target]); return; }
        if (s.type === "choice") { const $active = $input.find(".fco-wiz-choice.active"); const raw = $active.length ? $active.data("val") : null; if (raw !== null && raw !== undefined) { const val = (raw === "true") ? true : (raw === "false" ? false : raw); setValueByTarget(s.target, val); } return; }
        
        // --- FIX FOR MAPPING DYNAMIC IDs ---
        if (s.type === "text" || s.type === "textarea") { 
            const fieldId = `wiz-field-${s.id}`;
            const $f = $input.find(`#${fieldId}`);
            // Safety check: if field exists, get val, else empty string
            const v = $f.length ? String($f.val() || "") : "";
            setValueByTarget(s.target, v); 
            return; 
        }
      };

      const renderStep = async () => {
        const s = currentStep();
        if (!s) return;
        
        updateProgress();
        setNavState();
        
        $meta.html(`<div class="fco-wiz-stepnum">Step ${idx + 1} of ${stepCount()}</div><div class="fco-wiz-steptitle">${this.escapeHtml(s.title || "")}</div>`);
        
        // RENDER UI FIRST (Task C1)
        renderInputForStep(s);
        
        // THEN TYPE PROMPT
        await typewriter(s.text || "");
      };

      const goNext = async () => {
          if (navLocked) return;

          const s = currentStep();
          if (!s) return;

          // If typing is in progress, first click finishes typing (does NOT advance)
          if ($q.attr("data-typing")) {
            finishTypingNow(s);
            return;
          }

          if (s.type === "page_builder") { const pages = Array.isArray(this.wizardState.pages) ? this.wizardState.pages : []; if (!pages.length) { $input.find(".fco-wiz-hint").first().text("Please add at least one page to continue."); return; } }

          navLocked = true;
          $next.prop("disabled", true).addClass("is-busy");

          try {
            // Map and save first
            mapWizardStepValueToData(s);

            // If save is heavy, do not block UI longer than needed
            await this.saveData(true);

            // Advance exactly once
            idx++;

            if (idx >= stepCount()) {
              this.data.project.wizard_complete = true;
              await this.saveData(true);
              this.switchMode("editor");
              return;
            }

            await renderStep();

          } finally {
            navLocked = false;
            $next.prop("disabled", false).removeClass("is-busy");
          }
      };
      
      const goBack = async () => {
          if (navLocked) return;

          // Cancel typing and show full text instead of jumping mid-animation
          const s = currentStep();
          if ($q.attr("data-typing")) finishTypingNow(s);

          navLocked = true;
          $back.prop("disabled", true).addClass("is-busy");

          try {
            idx = Math.max(0, idx - 1);
            await renderStep();
          } finally {
            navLocked = false;
            $back.prop("disabled", false).removeClass("is-busy");
          }
      };
      
      // Bind once (Task B3)
      $next.off("click.fcoWizard").on("click.fcoWizard", goNext);
      $back.off("click.fcoWizard").on("click.fcoWizard", goBack);
      
      $(document).off("keydown.fcoWizard").on("keydown.fcoWizard", (e) => { if (!$("#fco-client-app").hasClass("mode-wizard")) return; if (e.key === "Escape") { $("#wiz-suggest").empty().hide(); } });
      renderStep();
    },

    syncWizardPagesToData: function () {
      const list = Array.isArray(this.wizardState.pages) ? this.wizardState.pages : [];
      if (!list.length) return;
      this.data.pages = []; const stack = []; const base = Date.now();
      list.forEach((item, i) => {
        const level = Math.max(0, Math.min(3, parseInt(item.level, 10) || 0));
        const parent = level === 0 ? null : (stack[level - 1] || null);
        stack[level] = item.id; stack.length = level + 1;
        this.data.pages.push({ id: item.id, title: item.title || "Untitled", parent: parent, sort: base + i });
        if (!this.data.drafts[item.id]) this.data.drafts[item.id] = { status: "empty", goal: "", notes: "" };
      });
      this.saveData(true);
    },

    // ------------------------------------------------------------
    // UTILITIES & SYNC
    // ------------------------------------------------------------
    initWpEditor: function (id, conf) {
      if (!window.wp || !wp.editor || !wp.editor.initialize) { const $el = $(`#${this.cssEscape(id)}`); if($el.length) $el.on("input", () => conf.onChange($el.val())); return; }
      try { wp.editor.remove(id); } catch (e) {}
      wp.editor.initialize(id, {
        tinymce: { wpautop: true, menubar: true, toolbar1: "formatselect,bold,italic,underline,bullist,numlist,blockquote,link,unlink,removeformat", toolbar2: "undo,redo,fullscreen", plugins: "lists,link,paste,wordpress,wplink,fullscreen", setup: (ed) => { ed.on("Change KeyUp SetContent", () => conf.onChange(ed.getContent())); } },
        quicktags: true, mediaButtons: true
      });
      $(`#${this.cssEscape(id)}`).off("input.fcoWp").on("input.fcoWp", () => conf.onChange($(id).val()));
    },
    destroyWpEditor: function () { if (this.wpEditorId && window.wp && wp.editor) try { wp.editor.remove(this.wpEditorId); } catch (e) {} this.wpEditorId = null; },
    syncToWpDraftPages: function () {
      if (!confirm("This will:\n1. Create WP Pages.\n2. Create Categories/Tags.\n3. Create WP Users.\n4. Update Site Title/Tagline.\n5. Save Brand Colors to Options.\n\nContinue?")) return;
      this.setSaveState("saving"); $(".fco-save-indicator").text("Syncing to WP...");
      this.apiPost("/project/sync_pages", { project_id: FCO_Config.projectId }).done((res) => {
        this.setSaveState("saved"); const r = res.report || {};
        alert(`Sync Success!\n\nPages Created: ${r.pages_created}\nTerms Created: ${r.terms_created}\nUsers Created: ${r.users_created}\n\nSite settings updated.`);
      }).fail((xhr) => { this.setSaveState("error"); alert("Sync failed. Check console."); console.error(xhr); });
    },
    exportJson: function () { const b = new Blob([JSON.stringify(this.data, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "content-onboard-backup.json"; a.click(); },
    importJson: function (e) {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = async (evt) => {
        try {
          let j = JSON.parse(evt.target.result);
          if (!j || !Array.isArray(j.pages)) { alert("Invalid JSON file: Missing 'pages' array."); return; }
          j.project = j.project || {}; j.branding = j.branding || {}; j.content = j.content || {}; j.drafts = j.drafts || {}; j.pages = Array.isArray(j.pages) ? j.pages : [];
          if (FCO_Config.isAdmin) { j.project.wizard_complete = true; }
          this.data = j; $(".fco-save-indicator").text("Importing...");
          await this.apiPost("/project/save", { project_id: FCO_Config.projectId, data: this.data });
          this.setSaveState("saved"); alert("Import successful! Reloading."); window.location.reload();
        } catch (err) { console.error(err); alert("Error: " + err.message); this.setSaveState("error"); }
      }; r.readAsText(f); e.target.value = "";
    },
    sendEmailSummary: function () {
        if (!confirm("Send project summary email to your admin email?")) return;
        this.setSaveState("saving"); $(".fco-save-indicator").text("Sending Email...");
        this.apiPost("/project/email_summary", { project_id: FCO_Config.projectId }).done((res) => {
            this.setSaveState("saved");
            alert("Email Sent Successfully!");
        }).fail((xhr) => {
            this.setSaveState("error"); 
            alert("Failed to send email. Check console/logs.");
            console.error(xhr);
        });
    },
    saveData: function (s) { if (!s) this.setSaveState("saving"); return this.apiPost("/project/save", { project_id: FCO_Config.projectId, data: this.data }).done(() => !s && this.setSaveState("saved")).fail(() => !s && this.setSaveState("error")); },
    debouncedSave: function () { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.saveData(true), 450); },
    setSaveState: function (s) { $(".fco-save-indicator").text(s === "saving" ? "Saving..." : (s === "error" ? "Error" : "Saved")).removeClass("is-saving is-error").addClass(s === "saving" ? "is-saving" : (s === "error" ? "is-error" : "")); },
    uid: function (p) { return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; },
    cssEscape: function (s) { return String(s || "").replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g, "\\$1"); },
    escapeHtml: function (s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); },
    escapeAttr: function (s) { return this.escapeHtml(s); }
  };
  $(document).ready(() => App.init());
})(jQuery);