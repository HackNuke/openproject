// -- copyright
// OpenProject is a project management system.
// Copyright (C) 2012-2015 the OpenProject Foundation (OPF)
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 3.
//
// OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
// Copyright (C) 2006-2013 Jean-Philippe Lang
// Copyright (C) 2010-2013 the ChiliProject Team
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
//
// See doc/COPYRIGHT.rdoc for more details.
// ++

import {WorkPackageResource} from 'core-app/modules/hal/resources/work-package-resource';
import {WorkPackageEditContext} from './work-package-edit-context';
import {ChangesetEvents, WorkPackageChangeset} from './work-package-changeset';
import {combine, deriveRaw, multiInput, MultiInputState, State, StatesGroup} from 'reactivestates';
import {map} from 'rxjs/operators';
import {StateCacheService} from '../states/state-cache.service';
import {WorkPackageCacheService} from '../work-packages/work-package-cache.service';
import {Injectable, Injector} from '@angular/core';
import {WorkPackagesActivityService} from "core-components/wp-single-view-tabs/activity-panel/wp-activity.service";

class WPChangesetStates extends StatesGroup {
  name = 'WP-Changesets';

  changesets = multiInput<WorkPackageChangeset>();

  constructor() {
    super();
    this.initializeMembers();
  }
}

@Injectable()
export class WorkPackageEditingService extends StateCacheService<WorkPackageChangeset> {

  private stateGroup:WPChangesetStates;

  constructor(readonly injector:Injector,
              readonly wpActivity:WorkPackagesActivityService,
              readonly wpCacheService:WorkPackageCacheService) {
    super();
    this.stateGroup = new WPChangesetStates();
  }


  /**
   * Start or continue editing the work package with a given edit context
   * @param {workPackage} Work package to edit
   * @param {events} Events on the changeset to listen to
   * @return {WorkPackageChangeset} changeset or null if the associated work package id does not exist
   */
  public changesetFor(workPackage:WorkPackageResource, events:Partial<ChangesetEvents> = {}):WorkPackageChangeset {
    const state = this.multiState.get(workPackage.id);

    if (state.isPristine()) {
      state.putValue(new WorkPackageChangeset(this.injector, workPackage, {
        onSaved: this.onSaved.bind(this),
        onUpdated: (changeset) =>  this.updateValue(changeset.workPackage.id, changeset),
        ...events,
      }));
    }

    const changeset = state.value!;
    changeset.workPackage = workPackage;

    return changeset;
  }

  /**
   * Get a temporary view on the resource being edited.
   * IF there is a changeset:
   *   - Merge the changeset, including its form, into the work package resource
   * IF there is no changeset:
   *   - The work package itself is returned.
   *
   *  This resource has a read only index signature to make it clear it is NOT
   *  meant for editing.
   *
   * @return {State<WorkPackageResource>}
   */
  public temporaryEditResource(id:string):State<WorkPackageResource> {
    const combined = combine(this.wpCacheService.state(id), this.state(id));

    return deriveRaw(combined,
      ($) => $
        .pipe(
          map(([wp, changeset]) => {
            if (wp && changeset && changeset.resource) {
              return changeset.resource;
            } else {
              return wp;
            }
          })
        )
    );
  }

  public stopEditing(workPackageId:string) {
    const changeset:WorkPackageChangeset|undefined = this.multiState.get(workPackageId).value;
    if (changeset !== undefined) {
      changeset.clear();
    }
  }

  protected load(id:string) {
    return this.wpCacheService.require(id)
      .then((wp:WorkPackageResource) => {
        return new WorkPackageChangeset(this.injector, wp);
      });
  }

  protected onSaved(changeset:WorkPackageChangeset) {
    const workPackage = changeset.workPackage;
    this.wpActivity.clear(workPackage.id);

    // If there is a parent, its view has to be updated as well
    if (changeset.workPackage.parent) {
      this.wpCacheService.loadWorkPackage(workPackage.parent.id.toString(), true);
    }
    this.wpCacheService.updateWorkPackage(workPackage);
  }

  protected loadAll(ids:string[]) {
    return Promise.all(ids.map(id => this.load(id))) as any;
  }

  protected get multiState():MultiInputState<WorkPackageChangeset> {
    return this.stateGroup.changesets;
  }
}

